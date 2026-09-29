# Round 2 · The v10 Port as a Toy Engine, with Milestones That Ship Joy

[← all round-2 ideas](README.md)

## Direction notes

KEY DECISION: make everything closed-form, and let that choice carry the engine. If every display motion is f(base, instanceIndex, t, uniform slots), then (a) the core toys need no compute, storage buffers or transform feedback, so poke, burst, heat, knife and tug behave identically on the ~13% on the GL2 fallback (Touch Field); (b) the play layer costs 0 bytes per atom, and the atom path never needs maxStorageBuffersInVertexStage, the iPhone limit nobody has verified (Zero-Byte Play); (c) evaluating at the previous frame's time gives exact per-fragment motion vectors for impostors (Twin Velocity), which three r186's VelocityNode can't (I read its source: it uses the raw geometry varying); (d) a few KB of events replays a session exactly (Replay Tape), which becomes the dual-lane test format for every other pitch.

VERIFIED IN THE r186 SOURCE (probe-canary three 0.186.1): onDeviceLost only logs and sets _isDeviceLost, and 'destroyed' losses are ignored (so Phoenix is real work, and its test must use CDP crashGpuProcess or a direct onDeviceLost call); material.mrtNode, uniformArray, Loop/If, PCG uint hash(), packHalf2x16, reversedDepthBuffer with an EXT_clip_control check on GL2, viewZToReversedPerspectiveDepth and viewZToLogarithmicDepth, compileAsync(object, camera, targetScene) yielding to the main thread, compileComputeAsync, readRenderTargetPixelsAsync(textureIndex). From the math source: the spring map (omega = 2/smoothTime and its three damping branches) is mirrored exactly in TSL. From Lupi's code: the uProgress mix in atoms and bonds, the 256-texel colormap (so prop fits in u8), current near/far and minDistance formulas, no existing device-loss recovery, and no bundle budget beyond Vite's 800 KB warning.

TENSIONS RESOLVED. (1) The engineer said to add only the offset buffer and flag byte in R3 and defer velocity until the spike. I keep R3's added scope to the Touch Field plus the flag byte; velocity arrives in M5 as a prewarmed TSL variant gated by the spike and the canary frame, so it isn't throwaway and doesn't bloat R3. (2) 'Months with nothing to feel': the milestones only reorder the migration map's own work packages, and a separate /next build (sidestepping the unanswered fiber 9+10 single-bundle question) puts each milestone in real hands and yields device telemetry early. (3) The v9 slice as asked ('upload a gas cloud as the from frame') gives only a lockstep condense. The Keyframe Relay gets bottom-up stagger and overshoot with zero GLSL, by feeding keyframes from the TS twin that R3 later keeps. (4) 'Sparse storage for IK' became a 32-entry uniform table addressed by 5 scratch bits in the R2 flag byte: still zero bytes per atom. (5) 'Camera-relative everywhere' was downgraded after computing the precision budget: at Lupi's scales (up to about 2,300 Å) jitter at 1 Å zoom is about 0.14 px. The real wins are reversed-Z plus per-frame near/far fitting, and the floating origin is reserved for stages beyond 1e4 Å.

LEFT OUT DELIBERATELY: new Looks, the gesture grammar (D2), share formats (D4), science twins (D5), XR (frozen; the ladder only schedules the R10 decision). No FPS or recovery-time claims anywhere: the gate spike defines metrics and relative thresholds instead. Honesty is structural: the toys' import wall, pinned atoms exempt from the field, the export barrier and uTouchCount = 0 in export.

Sources: https://github.com/mrdoob/three.js/issues/33821 ; https://github.com/mrdoob/three.js/issues/32735 ; https://web3dsurvey.com/webgl2/extensions/EXT_clip_control ; https://docs.google.com/document/d/1Vceem-nF4TCICoeGSh7OMXxfGuJEJYblGXRgN9V9hcE/mobilebasic (Chromium GPU program caching) ; https://pkg.go.dev/github.com/chromedp/cdproto/browser (CDP Browser.crashGpuProcess, experimental) ; https://developer.chrome.com/blog/new-in-webgpu-117/

<a id="r2-port-as-toy-engine-01"></a>
## Joy Ladder: the port re-cut into eight milestones that each end in a toy, shipped early on a /next lane
`R2-port-as-toy-engine-01` · system · effort M · judges mean **3.6** (E4 P3 A3 Pr5 M3; champion 1, keep 4) · self-scored fun 3 / visual 3 · perf improves

> Reorder R1-R12 without adding scope, so each milestone ends in a toy a visitor can feel: arrival, poke, burst, bonds that hold, glow, labels that shatter, instant replay. Each ships to an opt-in /next build months before the production cut-over.

**Framing:** problem->solution

**Builds on:** C001+C027+C002+C014+C030+C028+C103

**Problem:** The migration map orders Phase 1 by package (1a platform ... 1j CI) and exits only on 'parity', so the first v10 fun a visitor sees arrives after R6, about 4-5 months in. Judges scored C001 3/5 for play for exactly this reason. The engineer warned that hooks added ad hoc will stretch the XL impostor port (R3) and muddy the early-Z gate. No milestone has an acceptance test a visitor would notice, and nothing reaches a real phone before cut-over, so the device data C014 and C004 depend on arrives last.

**Solution:**

RULE: every milestone = work packages from v10-migration §9 + one toy that only works if those packages are right + a Replay Tape exit test in both R11 lanes + one PII-free delight event. The durations are the brief's own engineer-weeks (2 + 1 + 13-20), reordered, not re-estimated.
M0, Phase 0 on v9, wk 1-2, 'It arrives': R1 pins; the R2 repack with the flag byte reserved and always 0 (the plan's own Phase 0 item: three attribute declarations in the existing GLSL, not feature GLSL); the ExportManager state machine (R7 prep) with a snapDisplayToRest() capture barrier; C002 demand frames on scheduler 0.2.0; the Keyframe Relay condense and switch scatter. Exit: the entrance tape passes the current WebGL lane, and an export captured mid-entrance is byte-identical to one captured at rest.
M1, gate spike, wk 3, 'Poke on a real phone': the spike sandbox ships the TSL impostor plus the Touch Field's RIPPLE slot (see Parity Exit by Poke). Exit: a go/no-go report. The poke is the first v10 thing anyone touches.
M2, 1a+1b+1j, wk 4-9, 'Tap it and it rings': platform swap, atom port and dual CI lanes; Warm Start and the canary frame; the Zero-Byte layout; poke and burst live. PARITY EXIT: the poke and burst tapes pass in both lanes and on the device lab, and the default look matches its parity goldens.
M3, 1c, wk 9-10, 'Bonds hold on': bonds evaluate the field at both endpoints through uvec2 atom pairs; a per-atom GPU stagger replaces the relay; the recycler's product bonds grow in. Exit: the bond-endpoint twin test.
M4, 1f+1d, wk 10-13, 'Sleeps cool, wakes instantly': the phase map, zero idle frames, Studio as a Look with its shake (C042), Phoenix recovery. Exit: the idle-frame counter reads 0 after the analytic settle; the device-loss tape passes.
M5, 1e, wk 13-15, 'Glow and melt': highlight glow from the flag byte, two-look blends (C048), object-only motion blur on bursts, and desktop TRAA if Twin Velocity passes. Exit: the velocity twin test plus look goldens on both backends.
M6, 1g, wk 15-17, 'Words that shatter': glyph labels follow the twins and break apart on burst.
M7, 1h, wk 17-20, 'Share what I just did': Replay Tape feeds Instant Replay through the capture service, and export V2 proves the fun layer is excluded. Production cut-over on three r187 or later.
R10 (XR) is decided in M2; the default is to defer immersive XR and keep USDZ Quick Look as the iPhone AR path.
/next LANE: we can't assume fiber 9 and 10 coexist in one bundle (open question 4), so build apps/web twice. v9 stays in production at /; a v10 build with Vite base '/next/' is served as static assets by the same Worker. A 'Try the new engine' link lives only in the viewer's Style sheet (never on /), next to a feedback chip. Every milestone from M1 deploys there, and opt-in visitors emit PII-free events (time-to-first-poke, first burst, hitches per flick, backend kind, Low Power Mode detected) that tune C004 before production depends on it.

**Experience:** Desktop: from week 2 the first molecule you open condenses in. From M2 a click ripples it, and Burst (button or the B key) blows it apart before it clicks back. Phone: the same, with tap; /next is one tap from the Style sheet and carries a small 'experimental engine' chip. Keyboard: every milestone's toy has a key (Enter pokes the focused atom, B bursts, Esc resets). Reduced motion: each milestone's toy draws one still per action (a ring highlight or a crossfade). Screen reader: toys announce through aria-live, for example 'Rippled from oxygen 3, illustrative'.

**Tech:** R1-R12 as specified; @pmndrs/scheduler 0.2.0 on v9, then v10 phases; fiber/tsl/test-renderer canary triplet pinned to one hash; three 0.186.1 during development, r187 floor for cut-over (#34597 GL2 leak); Vite second build with base '/next/'; Worker static-asset mount; Playwright dual lanes using the SwiftShader Vulkan flags already in playwright.gpu-studio.config.mjs:17-22.

**Backend:** mixed

**Rides (v10 requirements):** R1-R12 (sequencing), R11 for every exit test, R10 decision point

**v9 slice:** All of M0: the relay condense and scatter, demand frames on scheduler 0.2.0, the ExportManager barrier, the R2 repack with a reserved flag byte, and the tape recorder.

**WebGL2 fallback:** From M2, /next runs on both backends, and every exit tape runs in the GL2-fallback lane (today's --disable-webgpu lane). The production cut-over waits for r187 so old iPhones don't leak GL programs on Look and molecule churn.

**Where in code:** apps/web/vite.config.ts (second build, base); apps/mcp-worker static-asset routing for /next; packages/ui/src/viewer/ViewerCanvas.tsx; packages/ui/src/export/ExportManager.tsx:180,349,449; playwright.config.mjs:55 and playwright.gpu-studio.config.mjs:17-22; tests/ui/tapes/ (new).

**Risks:** Two builds double CI time and cache. /next visitors are self-selected, so their perf data is biased. Alpha churn (alpha.6 moves the TSL hooks) can cost a week between milestones. With one engineer the milestones are sequential, so an R3 overrun slides every later one. /next routing must not touch the V1 or legacy asset routes. A public experimental lane creates support load.

**Honesty:** Durations are the migration map's estimates, reordered. No FPS claims: device numbers come from the spike and /next telemetry. /next is labelled experimental. Deterministic export (V1, then V2) never includes the fun layer.

**Judges:**

- E 4/keep: The right shape of plan: each R1-R12 milestone gets a feelable exit toy and a tape test, and the /next lane gets real-device data months early. 'Without adding scope' is optimistic: a second Vite build doubles CI, and each milestone toy is real work for one engineer. *Improve:* Serve /next as a flagged route on the same build. Limit milestone toys to those that are parity tests (poke, burst, bonds follow).
- P 3/keep: Re-cutting the port so that every milestone ends in a toy you can feel, shipped on /next, is the right antidote to four dead months. But it's a plan; the fun lives in the toys. *Improve:* Make a stranger playtest part of every milestone's exit, not just the tape, and invite non-developers to /next.
- A 3/keep: Every milestone ending in something a visitor can feel is the right sequencing, but the exits test toys only, not how they look. *Improve:* Add sig-10 goldens for the Looks each milestone touches to its exit test.
- Pr 5/champion: The best sequencing idea in either round. It reorders the same engineer-weeks so each milestone ends in a toy a visitor can feel plus a delight event, and the opt-in /next lane buys real feedback months before the cut-over. *Improve:* Give /next a named release operator and rollback under the release-truth contract. Write kill criteria for each milestone.
- M 3/keep: A /next lane gets real devices onto v10 months earlier, but its users are self-selected and CI time doubles. *Improve:* Make PT-09 the M1 exit gate and PE-11's contract a gate for every milestone, so /next never ships a toy without a still and a keyboard path.

<a id="r2-port-as-toy-engine-02"></a>
## Keyframe Relay: a staggered condense, a switch scatter and an atom recycler on today's uProgress hook, with zero new GLSL
`R2-port-as-toy-engine-02` · toy · effort M · judges mean **4.2** (E5 P4 A4 Pr5 M3; champion 1, keep 3, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> Feed v9's existing GPU lerp (instancePosition to instanceTargetPosition by uProgress) a short relay of keyframes sampled from the future deformer's TypeScript twin. v9 gets a bottom-up, springy condensation entrance, a scatter-and-condense switch and a bookkeeping recycler, and the twin code survives the port.

**Framing:** capability->problem

**Builds on:** C030+C118+C077+C027

**Problem:** Molecules pop in dead still and switches snap. Round 1's v9 slice (upload a gas cloud as the 'from' frame) gives only a lockstep condense: uProgress is one uniform and is clamped to [0,1] in AtomsOptimized's useFrame, so there is no stagger and no overshoot, and it reads as a zoom rather than a condensation. Any per-atom stagger in v9 would be new GLSL that the port throws away.

**Solution:**

MECHANISM. (1) packages/core/src/play/twins.ts defines closed-form deformers in TS: condense(base, i, t, seed), burst(...), recycle(from, to, i, t). Each atom's delay is D times its normalized height along camera-up (an art-directed bottom-up stagger), plus jitter from a PCG hash implemented with Math.imul. That is the same uint hash as three r186's TSL hash() (source-verified), so R3 can mirror it bit-exactly. Each atom's progress is the response of the 'boing' motion token computed with math/time spring.update, so overshoot is allowed. (2) A displayRelay controller samples the twin at K keyframe times. At each boundary it writes keyframe k into instancePosition and keyframe k+1 into instanceTargetPosition through the existing partial update path (markInstancedAttributeUpdateRange), and drives uProgress linearly across the segment through a new displayProgressRef prop. That prop overrides the playback-derived value in AtomsOptimized's useFrame and may run from -0.05 to 1.05 so overshoot survives; createAtomInterpolationBoundingSphere is inflated by the same margin. K scales with atom count: 8 segments up to 5k atoms, 4 up to 30k, 1 above that (lockstep, the round-1 slice), and a 200 ms fade above 200k. (3) Bonds use their own four lerp attributes (instanceStart/End plus targets, bondImpostor.ts:56-57), fed from the same keyframes through the CPU bond pairs; above 30k atoms they fade in over the last 250 ms instead.
BEATS. Entrance (first open per session, 600 ms or less; any pointerdown or keydown snaps it to rest in the same frame): at 0 ms a seeded gas cloud of 1.6x the bound radius; from 80 to 480 ms atoms condense bottom-up; 3% overshoot and settle; a chip reading 'Arrival animation, illustrative' fades after 1.5 s. Switch: A bursts to a cloud in 180 ms; the file swap happens inside the cloud (both clouds share one seed and radius, so density changes but the cloud doesn't jump); B condenses in 380 ms; chip: 'Transition, not a reaction'. Recycler (C077 rework): three curated balanced reactions (methane combustion, water formation, fermentation). Each is a 2-frame file whose atom order encodes an offline atom mapping, so today's trajectory scrubber plays it and one mid-arc keyframe lifts the atoms on a gentle arc. Bonds hide in transit, are re-inferred on the product frame and fade in. Label: 'Atom bookkeeping, not mechanism', with a cited source per reaction.
SAFETY. The CPU picker, labels and measurements read store positions, so any touch snaps the relay to rest first. ExportManager's barrier calls snapDisplayToRest(), so exports never see relay positions.
TEST (R11, the current WebGL lane now and both lanes after M2): vitest checks twin settle times at 30, 60 and 120 Hz. Playwright checks that a screenshot of the entrance tape at rest equals the no-entrance screenshot, that an export taken mid-entrance is byte-identical to one at rest, and that a tap during the entrance picks the atom under the finger.

**Experience:** Desktop: the first molecule you open condenses out of mist, bottom-up, and clicks into place; switching puffs it to mist and re-forms the next one. Phone: the same, with fewer segments on big files; a tap anywhere lands it instantly, and a scroll gesture is never blocked. Keyboard: any key skips; the Recycler scrubber is a slider with arrow keys and aria-valuetext ('45%, carbon heading to CO2'). Reduced motion: a crossfade from a still of the cloud to the rest pose, one still per action. Screen reader: 'Caffeine loaded, 24 atoms'; motion is never narrated.

**Tech:** The existing mix(instancePosition, instanceTargetPosition, uProgress) at AtomsOptimized.tsx:367 and the bond lerp at bondImpostor.ts:56-57; markInstancedAttributeUpdateRange; math@0.1.0 time (spring.update, fromResponse) and random (mulberry32) for the cloud; a PCG hash via Math.imul that mirrors three r186 TSL hash(); scheduler 0.2.0 job (or useFrame on v9).

**Backend:** DOM/CPU (ships on v9 today); becomes a [GPU+GL2] per-atom delay in the R3 positionNode

**Rides (v10 requirements):** none on v9; R3/R4 replace the relay with a per-atom delay in positionNode, keeping the twins

**v9 slice:** All of it. No GLSL is touched; the only renderer-side change is one TS prop that overrides uProgress.

**WebGL2 fallback:** v9 is already WebGL2. After R3 the stagger runs in the vertex stage on both backends; the relay controller is deleted, but twins.ts stays as the CPU twin for picking, labels and velocity tests.

**Where in code:** packages/scene/src/AtomsOptimized.tsx (useFrame near 1576; upload effect near 1690-1710; createAtomInterpolationBoundingSphere); packages/scene/src/Bonds.tsx and bondImpostor.ts (four lerp attributes, fade uniforms); packages/core/src/play/twins.ts (new); packages/ui/src/export/ExportManager.tsx (barrier); packages/ui/src/switcher/MoleculeSwitcher.tsx.

**Risks:** Each boundary uploads 2 x N x 12 B, which is fine up to the 30k cap. Piecewise-linear segments show velocity kinks if K is too low. The picker disagrees with the display if any path forgets snap-on-touch. The recycler mappings are curation work. The entrance could tire returning users, so it runs on the first open per session only.

**Honesty:** Every motion is labelled in words (arrival, transition, bookkeeping). Only display attributes move; source atoms never do. Exports snap to rest first. The recycler never implies a mechanism and cites the balanced equation's source.

**Judges:**

- E 5/champion: The best v9 slice in the set. The CPU twin samples staggered per-atom positions at K keyframes, and the existing uProgress lerp (atoms and bonds) interpolates between them: zero GLSL, bonds follow, and twins.ts survives as R3's CPU twin. I verified the TSL hash in three 0.186.1 is PCG (747796405/2891336453), so a Math.imul mirror can be bit-exact. Uploading 2·N·12 B per boundary is fine up to ~30k atoms. It hosts flagship-04. *Improve:* Choose K by curvature to avoid velocity kinks. Exclude trajectories, and give one owner to uProgress (the Mode Harp and Pop-It v9 slices also want it). Snap the picker to twin positions.
- P 4/keep: It gets a springy, staggered condense and a switch scatter on v9 with zero GLSL, juice months before R3, and the TypeScript twins survive the port. Switching molecules becomes a small show every time. Risk: velocity kinks if there are too few keyframes. *Improve:* Host Arrival Router's rules and Condense's grammar here. Tune the keyframe count by eye on C60 and caffeine, and never play it on trajectories.
- A 4/merge: Host: R2-signature-and-moonshots-07. It is the v9 route to a springy, staggered condense with zero GLSL, and its twins survive the port. But piecewise-linear keyframe segments show velocity kinks as visible mechanical hitches. *Improve:* Merge as sig-07's v9 implementation. Keep enough segments for motion that looks C1-smooth, and add a kink test.
- Pr 5/keep: It ships the house arrival, the switch morph and the recycler on v9 with zero new GLSL, and its TS twins carry over to R3, so visitors feel joy within weeks. It hosts flagship-04. *Improve:* Take in Arrival Router's rules table. The recycler waits for real-twins-11's citations.
- M 3/keep: A zero-GLSL v9 condense and scatter; lens-neutral beyond obeying FM-04's rules. *Improve:* Route every playback through FM-04's rules (no arrival above 50k atoms, a crossfade under reduced motion), and cap boundary uploads on phones.

<a id="r2-port-as-toy-engine-03"></a>
## Touch Field: one vertex function, eight uniform slots, and every toy a CPU controller
`R2-port-as-toy-engine-03` · system · effort M · judges mean **4.2** (E5 P4 A4 Pr4 M4; champion 1, keep 4) · self-scored fun 4 / visual 4 · perf neutral

> A single closed-form TSL function, evaluated in the atom and bond positionNodes, reads eight fixed uniform slots of {kind, origin, t0, params}. Ripple, wake, burst, condense, heat, knife, tug and pluck are just slot kinds, so a new toy is TypeScript that writes slots: no new material, no compile, and the same behaviour on both backends.

**Framing:** problem->solution

**Builds on:** C027+C028+C029+C030+C033+C035+C031+C073+C001

**Problem:** Round 1 has about ten displacement toys (C028 ripple, C029 wake, C030 burst, C033 heat, C035 knife, C031 tug, C073 pluck, C034 shock), each implying its own shader or compute kernel. Every new material pays #33821-class init cost and a compile hitch on first use. Compute kernels hit transform-feedback limits on GL2. Dense offset buffers cost 12-16 B per atom.

**Solution:**

SPEC. Slots: uTouch = uniformArray of 24 vec4, i.e. 8 slots x 3 vec4. s0 = (origin.xyz, t0); s1 = (axis or normal.xyz, amplitude in Å); s2 = (kind, omega, zeta, extra). Also uTouchCount (int), uNow, uMotionScale (0 under reduced motion) and uMaxOffset (a clamp in Å).
touchOffset(base, i, t) loops over the active slots with Loop(uTouchCount). Each kind is an If() on a uniform, so branches are coherent and select() never evaluates every kind. The envelope is causal: a TSL port of math/time's coefficients() evaluated at tau = t - t0 - r/c, and zero for tau < 0.
KINDS in v1: RIPPLE (radial damped wave on a crisp 400 ms token, the art director's tuning); WAKE (a capsule around the last pointer segment, at most 4 slots while dragging); BURST and CONDENSE (a PCG-hash direction blended with the radial one, per-atom delay by distance from the centroid, 'float' out and 'boing' back); HEAT (hash jitter interpolated between integer time keys, amplitude from a Kelvin slider; the C033 rework); KNIFE (half-space separation near a plane; C035); TUG (grab delta times a falloff in hop distance, where the hop count lives in the flag byte's 5 scratch bits, written on grab); PLUCK (the sum of modal amplitudes times mode vectors read from a tiny DataTexture, for baked heroes only; C073).
ALLOCATION. A CPU SlotPool with priorities evicts a slot only when its analytic envelope falls below 1e-3 Å, so eviction never pops and velocity stays continuous. Bonds (R4) call the same Fn at both endpoints through the uvec2 pair. Pinned atoms (a flag bit) are exempt, so a measured distance never reads a displaced atom.
CPU TWIN. touchOffsetCPU uses the same formulas (math/time plus PCG). It serves labels, measurement anchors, the hovered-atom rim, the analytic settle that tells C002 when to stop invalidating (maximum envelope under 0.5 px), and the tests.
CONTROLLERS. A toy is { onGesture -> slots, settle(), still() } running in the scheduler's input and update phases.
PARITY DEMO (M2). Tap ripples, with an optional C041 plink. Hold heats, with a visible K readout. Release bursts, and the molecule condenses back with a click. The 'Illustrative motion' chip lists the live slots and resets them all in one tap.
TEST (R11, both lanes). Replay the poke and burst tapes with advance(). Read 32 atom centres through the ID target, compare them with touchOffsetCPU projected to screen (0.5 px tolerance), and check that export with active slots is byte-identical to export at rest.

**Experience:** Desktop: a click ripples the molecule; dragging with the Play verb leaves a wake; the Burst button or B bursts it. Phone: a tap ripples (a 9x9 ID patch resolves the finger, per C009), and other verbs come from the Play chip under D2's gesture grammar. Keyboard: Enter ripples the focused atom (atom cursor); hold H to heat, with arrows setting the Kelvin value; B bursts; K places a knife plane from presets; Esc resets. Reduced motion: uMotionScale is 0 and each action draws one still, a ring highlight through the flag byte plus the caption 'rippled'. Screen reader: aria-live 'Ripple from O3, illustrative; atoms return in under a second'.

**Tech:** three r186 TSL uniformArray, Loop, If, Fn, hash (PCG, uint-only), instanceIndex, positionNode on the R3 impostor material; the R4 bond pair attribute; math@0.1.0 time (the spring-core coefficient map mirrored in TSL); scheduler input and update jobs; slots are plain frame-owned uniform() values inside useNodes (not useUniforms, to avoid the snap-back trap), while @react-three/tsl useUniforms carries only the mood bus.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3, R4 (and R2's flag byte for the pinned bit and scratch bits)

**v9 slice:** No GLSL. The TS twins and SlotPool ship in M0 inside Keyframe Relay with unit tests, so nothing is thrown away.

**WebGL2 fallback:** Identical on GL2: closed-form in the vertex stage, with no compute, storage buffers or transform feedback, and 8 slots in a 384 B uniform block. Only PLUCK needs a vertex-stage textureLoad, which the spike verifies on iOS 17/18.

**Where in code:** packages/scene/src/AtomsOptimized.tsx (R3 port: positionNode); packages/scene/src/Bonds.tsx and bondImpostor.ts (R4); packages/core/src/play/{twins,slots}.ts (new); packages/ui/src/toys/* controllers; packages/scene/src/AtomPicker.tsx (rim via the twin).

**Risks:** Vertex work scales with atoms x active slots, and all 4 quad vertices recompute the same centre, so cap slots at 2 above 400k atoms until the spike measures a 5M lattice with 2 and 8 slots. The bounding sphere and sub-pixel cull must include uMaxOffset. uniformArray's per-frame update on the GL2 uniform-block path is unverified. The kinds could sprawl: cap v1 at 8 kinds and review any addition.

**Honesty:** Every kind is display-only and clamped to 0.8 Å or less, except the whole-molecule burst and condense, which are labelled transitions. Export renders with uTouchCount = 0 by construction. Each kind names its real counterpart in the chip: ripple to baked modes, heat to the cu_melt run, burst to sand_w_cascade.

**Judges:**

- E 5/champion: Round 1's lesson made concrete. Eight uniformArray slots with If() per kind in the atom and bond positionNode make every toy a TypeScript controller, with no new material and no recompile. It is identical on GL2: no compute, storage or transform feedback. The honest cost is vertex ALU × active slots × 4 quad vertices at multi-million atoms, which it correctly caps pending the spike. *Improve:* Inflate cull bounds by uMaxOffset. Record per-slot cost from the gate spike and set per-tier slot caps. Absorb port-11's TSL spring-coefficient mirror so one module owns GPU envelopes.
- P 4/keep: The foundation that makes poke, wake, burst, heat, knife, tug and pluck cost only TypeScript, with no compiles. It directly multiplies the number of toys and cuts tap-to-feel latency. Pure infrastructure that unlocks the whole touch family. *Improve:* Evict slots gracefully (never cut a ripple mid-swing), and give toy authors a debug view of the slots.
- A 4/keep: One touch function whose envelopes come from the motion tokens is what makes ripple, burst, heat and pluck feel authored by one hand. *Improve:* Clamp uMaxOffset per Look. Let Bond Grammar strain and the Contact AO fade read the same slots.
- Pr 4/keep: It turns every future toy into a CPU controller with no recompile, which is enormous leverage. But it lands after R3, and its cost as atoms times slots grows has never been measured. *Improve:* Set slot caps from port-09's device results.
- M 4/keep: uMotionScale = 0 under reduced motion, uMaxOffset clamps and a 2-slot cap above 400k atoms build phone and comfort guards into the one shader function every toy uses. *Improve:* Set per-device slot caps from PT-09 data, attach a flash class to every slot kind (PE-09), and never let a slot outlive its settle bound.

<a id="r2-port-as-toy-engine-04"></a>
## Twin Velocity: exact motion vectors for impostors from the deformers' own past, plus object-only motion blur for bursts
`R2-port-as-toy-engine-04` · look · effort M · judges mean **2.6** (E3 P2 A4 Pr2 M2; keep 2, park 3) · self-scored fun 3 / visual 4 · perf costs

> Every display motion is closed-form in time, so each impostor fragment can evaluate its sphere centre at t and t-dt and write exact velocity through the material's mrtNode. That unlocks TRAA edges and a burst-only 'whoosh' blur that never smears the camera.

**Framing:** capability->problem

**Builds on:** C001+C027+C007+C030+C050

**Problem:** three r186's VelocityNode builds previous positions from positionPrevious, the raw geometry varying, and from object matrices (source-read). For GPU-lerped or displaced impostors it therefore gives the velocity of a quad corner, not the sphere surface. TRAA and TAAU ghost on moving atoms (the judges' -1 for 'temporal on moving atoms'), C007's path to dropping MSAA stays blocked, and bursts look like teleports at Low Power Mode's 30 Hz.

**Solution:**

(1) PER-FRAGMENT VELOCITY. In the R3 impostor fragment Fn, the ray hit is h = c_t + n*r. The previous hit is h' = c_prev + n*r, which is exact for a rigid sphere of constant radius. c_prev = mix(pos, tgt, uProgressPrev) + touchOffset(base, i, tPrev), where tPrev is the time of the previous presented frame, so demand-mode sleeps are handled. The Touch Field is causal and evicts only below 1e-3 Å, so there are no velocity spikes. Write v = ndc(PVcur*h) - ndc(PVprev*h') into material.mrtNode (per-material MRT override, present in r186); uPrevViewProj updates in a scheduler 'finish' job. On trajectory frame swaps, uProgressPrev = uProgress - delta, extrapolating along the new segment. Bonds (R4) use the hit point on the cylinder segment and interpolate the previous positions of both endpoints.
(2) TWO CONSUMERS, gated by the gate spike and the canary frame. (a) Desktop TRAA via the traa() node in the R6 pipeline. It replaces 4x MSAA only after a golden of a 1M-atom Cu lattice mid-orbit passes the shimmer check (the C007 rework path). (b) Object-only motion blur for the fun layer: a second velocity computed with PVprev set to PVcur removes camera motion, so bursts, condensations and switch scatters streak like a blown dandelion while flicks and orbits never smear (vestibular-friendly). Capped at 12 px; off under reduced motion, under Low Power Mode cadence, and during MD playback.
(3) COST CONTROL. The velocity attachment exists only while a consumer is on; it is a structural variant that Warm Start prewarms. Phones default to off.
TEST (R11, both lanes). Step a burst tape with advance(), read the velocity attachment with readRenderTargetPixelsAsync(textureIndex) at 32 atom-centre pixels found through the ID target, and compare with CPU-twin projected velocities within 0.5 px. A static scene must read |v| = 0. A camera-only orbit must read 0 in the object-only channel.

**Experience:** Desktop: silhouettes stay clean while you spin a 1M lattice, and a burst leaves soft streaks that vanish as the atoms settle. Phone: no velocity target by default because of tile-GPU bandwidth; bursts still read well because the spring tokens don't depend on frame rate. Keyboard and screen reader: no change. Reduced motion: blur off entirely, and TRAA stays as a quality aid.

**Tech:** three r186 material.mrtNode, mrt(), the traa() and motionBlur post nodes through @react-three/tsl useRenderPipeline (R6); VelocityNode read and rejected for impostors; readRenderTargetPixelsAsync with textureIndex; math-based CPU twins; scheduler finish phase.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3, R4, R6

**v9 slice:** None: it would be GLSL. The v9 twins from Keyframe Relay already produce the reference velocities these tests need.

**WebGL2 fallback:** GL2 supports MRT. TRAA on the GL2 backend is 'likely' but unverified, so the canary frame checks the velocity attachment and, on a mismatch, turns TRAA and blur off while everything else keeps working.

**Where in code:** AtomsOptimized fragment port (R3); bondImpostor port (R4); a new packages/ui/src/viewer/pipeline module (R6); packages/core/src/play/twins.ts.

**Risks:** Touch-field vertex work doubles while velocity is on. MRT bandwidth is expensive on tile GPUs. TRAA can still ghost at disocclusions on alpha-edged impostors, so history rejection needs tuning. uProgressPrev extrapolation errs on sharp trajectory turns. Motion blur must never apply to data motion.

**Honesty:** Blur applies only to illustrative motion, never to MD playback, where it would imply measured speed. TRAA is a display aid, and deterministic export uses the raw pass without it.

**Judges:**

- E 3/keep: Technically sound: the rigid-sphere previous hit is c_prev + n·r, written through material.mrtNode, which I verified exists in r186. It is the only credible route to impostor velocity. It doubles Touch Field vertex work while on, adds a velocity MRT that is costly on tile GPUs, and TRAA on alpha-edged impostors can still ghost. The brief applies −1 for temporal effects. *Improve:* Gate it to desktop WebGPU after the spike proves it. Never block parity on it. Keep burst-only motion blur optional.
- P 2/park: Blur on bursts and TRAA edges are nice polish, but invisible to a stranger next to the toys. It doubles vertex work while on and carries the brief's −1 for temporal effects on moving atoms. *Improve:* Revisit after the gate spike measures velocity and after bursts have shipped without blur.
- A 4/keep: Object-only motion blur on bursts, while orbits never smear, is a genuinely good motion idea. Exact impostor velocity also unblocks TRAA for clean silhouettes, which is C007's real fix. *Improve:* Keep it off on phones. Cap blur at 12 px and fade it with the settle. Add a mid-burst golden so a burst streaks like a blown dandelion rather than smearing.
- Pr 2/park: Casual visitors won't see it, it costs bandwidth on tile GPUs, and it is exactly the '-1 temporal on moving atoms' case the brief warns about. *Improve:* Revisit once the gate spike shows whether TRAA is needed.
- M 2/park: Velocity MRT costs tile-GPU bandwidth, it is temporal on moving atoms before velocity is proven (−1), and motion blur aggravates vestibular symptoms. *Improve:* Revisit as a desktop-only rung after the gate spike. Motion blur is always off under reduced motion and Gentle, and never on phones.

<a id="r2-port-as-toy-engine-05"></a>
## Zero-Byte Play: a 16-byte atom at 5M atoms, and every toy costs zero bytes per atom
`R2-port-as-toy-engine-05` · foundation · effort S · judges mean **3.2** (E5 P2 A2 Pr3 M4; champion 1, keep 4) · self-scored fun 2 / visual 1 · perf improves

> Fix the per-atom memory contract before R2 and R3 freeze it: an f32 position plus one packed 4-byte word (type, prop, occlusion, flags with toy scratch bits) is the whole atom. Closed-form deformers, PCG hashes and 5 scratch bits replace dense offset, velocity and phase buffers, so 5M atoms need 80 MB and poking them needs no storage buffer in the vertex stage.

**Framing:** problem->solution

**Builds on:** C027+C001+C009

**Problem:** The round-1 play sketch (v10-unlocks §1.3) stores base, target, offset and velocity as vec3 storage arrays (WGSL pads vec3 arrays to 16 B), plus attributes: about 68 B per atom, roughly 340 MB at 5M atoms. That strains iOS tabs and needs maxStorageBuffersInVertexStage, the limit whose iPhone Safari acceptance is still unverified. C027's dense f32 offset alone is 60 MB at 5M.

**Solution:**

LAYOUT PER ATOM. Position f32x3 attribute: 12 B. One packed unorm8x4/uint8x4 word: 4 B, laid out as [type slot u8][prop u8, matching the 256-texel colormap (buildColormapTexture)][occlusion u8][flags u8: bit0 selected, bit1 highlight (glow MRT), bit2 pinned (exempt from the Touch Field), bits 3-7 toy scratch: tug hop distance up to 31, FABRIK joint id up to 31, pluck group]. Trajectories add a target f32x3 (12 B).
TOTALS AT 5M ATOMS. 16 B/atom = 80 MB static; 28 B/atom = 140 MB while playing a trajectory.
PLAY LAYER: 0 B per atom. The Touch Field's slots take 384 B in total. IK and FABRIK joint deltas live in a 32 x vec4 uniform array addressed by the scratch bits, so round 1's 'sparse storage only for IK' becomes a uniform table. Baked pluck modes exist only for heroes of 200 atoms or fewer (about 10 KB of DataTexture). Hover is one uHoverId uniform, not a byte.
DENSE STATE IS THE EXCEPTION. A future stateful sim toy that truly needs per-atom state must use packHalf2x16 pairs (a half-precision vec3 in 8 B as two u32; TSL packHalf2x16 is present in r186), in its own buffer, [GPU] only, and pass a memory review.
PICKING. An RGBA8 ID target (24-bit id plus the flag byte). On touch devices it renders only on tap, as a scissored 9x9 patch (C009 critique).
BONDS (R4). A uvec2 atom pair (8 B) plus colour and order (4 B) = 12 B per bond, against about 52 B today with baked start, end and target positions.
LIMITS. For scenes above ~22M atoms, the renderer factory requests maxBufferSize and maxStorageBufferBindingSize from the adapter, and bricks are chunked.
VISIBLE PAYOFF. 'Poke a five-million-atom lattice' becomes a desktop hero candidate if the spike allows it.
TEST (R11). A vitest 'memory ledger' asserts that attribute bytes divided by capacity equal 16 (static) and 28 (trajectory). In both lanes, enabling every registered toy leaves geometry bytes unchanged. The WebGPU lane asserts, via pipeline-layout instrumentation, that no storage buffer is bound in the impostor vertex stage.

**Experience:** Invisible directly. Visitors feel it as big lattices that load on phones without the tab reloading, and as poke and burst working at every size the viewer draws. Keyboard and screen reader: unaffected.

**Tech:** r186 WebGPU attribute formats (itemSize-1 u8/u16 rejected, three.webgpu.js:84138-84142); InstancedBufferAttribute with itemSize 4 and normalized Uint8; TSL packHalf2x16/unpackHalf2x16 and uniformArray; readRenderTargetPixelsAsync(textureIndex); requiredLimits in the R3F v10 renderer factory.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R2, R3, R4, R12

**v9 slice:** The R2 repack ships in Phase 0 (valid on WebGL2, required on WebGPU), with prop narrowed to u8 and flags set to 0; the memory-ledger test ships with it.

**WebGL2 fallback:** The same vertex-attribute layout, with no storage buffers in the vertex stage. GL2 has no maxBufferSize, but device memory still bounds very large scenes, so they rely on bricks.

**Where in code:** packages/scene/src/AtomsOptimized.tsx:1262-1276 (attributes; colormap at :1113); packages/scene/src/Bonds.tsx:725-736 (bond attributes); packages/ui/src/deviceCapabilities.ts:30 (ceilings); packages/renderer/src/pipeline/AtomPipeline.ts:403-409 (precedent for requested limits).

**Risks:** Narrowing prop from u16 to u8 quantizes property emission; if that shows, add a second packed word only in property mode. Five scratch bits cap tug hops and chain joints at 31. Toys that genuinely need per-atom state (particle-life sims) are pushed off the atom path by design.

**Honesty:** The memory figures are arithmetic from byte layouts, not measurements. iOS tab-kill thresholds come from the spike, not from this idea.

**Judges:**

- E 5/champion: Small and timely: it freezes the per-atom contract before R2 and R3 lock it. 16 B/atom gives 80 MB at 5M atoms, well inside the 256 MiB default buffer, and closed-form play costs zero bytes per atom. It is the discipline that prevents a dense offset/velocity/phase-buffer creep. Other ideas already contend for these bits: Contact's AO word, Worn Bright's 4 bits, Pop-It's bit and highlight flags. *Improve:* Publish a single bit and word allocation table here, including Contact's directional-AO word (20 B/atom) and who owns scratch bits 3-7. Add the memory-ledger unit test in Phase 0.
- P 2/keep: A cheap, necessary memory contract. No fun on its own, but it keeps big scenes playable. *Improve:* Land it with the R2 repack and nothing more.
- A 2/keep: A memory contract. It matters to me because the flag byte is oversubscribed across ideas (glow, selected, pinned, scratch, cross-10's wear bits, cross-02's popped bit), and sig-03 wants 4 B per atom. *Improve:* Publish one bit allocation and include Contact's directional AO bytes in the ledger.
- Pr 3/keep: Cheap to decide before R2 freezes the attribute layout, and it prevents tab kills at scale. Visitors won't see it. *Improve:* Land it together with the R2 repack.
- M 4/keep: A 16 B/atom contract with zero-byte play layers is what keeps a 5M-atom scene under iOS's tab-kill line. *Improve:* Report into P-11's ledger and publish per-device atom caps from PT-09.

<a id="r2-port-as-toy-engine-06"></a>
## Warm Start: a first-interactive-frame budget, a variant manifest and an idle prewarm, so the first poke never compiles
`R2-port-as-toy-engine-06` · foundation · effort M · judges mean **3.8** (E5 P3 A3 Pr4 M4; champion 1, keep 4) · self-scored fun 3 / visual 2 · perf improves

> Define 'interactive' precisely, enumerate every pipeline the next tap could need, compile the visible variant behind the poster and the rest while idle, and run a canary frame whose readback turns silent GL2 failures into capability bits.

**Framing:** problem->solution

**Builds on:** C016+C004+C014+C048+C001

**Problem:** WebGPURenderer material setup is much slower than WebGL's. In three #33821 the issue author measured 10k meshes sharing one material at about 1,029 ms against about 28 ms on WebGL. Compute pipelines are cached per ComputeNode id (#32735). A shader compile on the first poke, burst or Look swipe is exactly the hitch that makes a toy feel broken, especially on phones. Nothing today defines when the viewer is interactive, and failures on the GL2 backend are silent.

**Solution:**

(1) FIF (first interactive frame): the first presented frame at full quality with gesture handlers live and zero pending pipelines for the current state and for everything one tap away. Report its p50 and p95 per device class in ?perf and in C014; budgets come from the spike and are not claimed here.
(2) VARIANT MANIFEST (viewer/variants.ts). List the structural variants that change a node graph and so need their own pipeline: impostor tier 0/1/2 x perspective/ortho x velocity MRT off/on x transmission; the bond variants; the pipeline graphs (default, Illustrate, the riso/halftone/blueprint skins, highlight bloom); and the compute kernels (gist, GPU bonds). Rule: anything reachable in one tap is either uniform-driven (Touch Field, mood, two-look blend, etch via If) or listed as prewarm-required. Keep render items few: labels batch into one instanced glyph mesh, because of the #30560 UBO cost.
(3) SEQUENCE. While the DOM poster (the C016 match frame) shows: await renderer.compileAsync(scene, camera) for the visible variant (non-blocking since r184, and it yields to the main thread); render the first frame; fade the canvas in. Then, on scheduler onIdle, never during the entrance or a gesture, and skipped under Save-Data or Low Power Mode: compileAsync(variantMesh, camera, scene) for likely next variants in priority order (look-pad neighbours, the top Remix rolls, ortho); compileComputeAsync for kernels; and a 1x1 'shadow render' of each alternate post graph, since whether compileAsync covers RenderPipeline quads is UNVERIFIED. Kernels and materials are built once and reused, never created per event (#32735).
(4) CANARY FRAME, extending Lupi's existing 'validate one submitted frame' pattern from GPU Studio, scan and action-light. Render a 16x16 target containing three known atoms and read it back asynchronously to check depth order, RGBA8 ID packing, the velocity attachment and reversed-Z. The result is a set of capability bits the toy registry reads; a failed bit sends that feature to its still or CPU path instead of failing silently on GL2.
(5) REPEAT VISITS may benefit from browser pipeline caches (Chromium's Dawn cache; Safari UNVERIFIED). This is measured, never assumed.
TEST (R11, both lanes). An init script wraps GPUDevice.prototype.createRenderPipeline, createRenderPipelineAsync, createComputePipeline and createComputePipelineAsync, plus WebGL2RenderingContext.prototype.linkProgram. After FIF, replay the 'first minute' tape (poke, burst, a look-pad neighbour, a Remix roll, the ortho toggle) and assert zero new pipelines or programs. FIF is logged but not gated, because SwiftShader timing is meaningless.

**Experience:** Desktop and phone: the molecule appears already interactive, and the first poke, burst and Look swipe never stutter. Keyboard and screen reader: focus moves into the canvas region only after FIF, so there is no dead focus. Reduced motion: unaffected; the poster-to-canvas swap is a crossfade.

**Tech:** three r186 compileAsync(scene or object, camera, targetScene), compileComputeAsync and readRenderTargetPixelsAsync; scheduler onIdle; R3F v10 async renderer factory; KHR_parallel_shader_compile on GL2; Chromium GPU program caching (per Chromium docs; other browsers unverified).

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3, R5, R6, R7, R12

**v9 slice:** Define FIF and measure it on v9 today (WebGLRenderer.compileAsync exists) in the ?perf HUD. Write the variant manifest as data now.

**WebGL2 fallback:** compileAsync uses KHR_parallel_shader_compile where the driver offers it. Canary bits catch GL2 divergences. Every variant stays resident instead of being rebuilt, which also avoids the r186 GL2 program leak (#34597) until the r187 floor.

**Where in code:** packages/ui/src/viewer/ViewerCanvas.tsx (factory, poster); packages/ui/src/export/renderCaptureState.ts:70-80 (warm-up precedent); packages/ui/src/gpu-studio/runtime.ts:385-394 and scan/swirl.ts:101-111 (validated-frame precedent); packages/ui/src/viewer/variants.ts (new).

**Risks:** Prewarming too many variants wastes memory and idle battery, so the manifest priority caps it. compileAsync coverage of post-pipeline quads is unverified. The poster-to-canvas swap must match exactly. Instrumenting createRenderPipeline is test-only and must never ship.

**Honesty:** No FIF or FPS numbers are claimed, and returning-visit caching is not assumed. The canary frame's capability bits are shown in ?perf so any degradation is visible, never hidden.

**Judges:**

- E 5/champion: It attacks #33821 slow material init head-on and defines first-interactive-frame, measurable on v9 today. The canary-frame readback that turns silent GL2-backend failures into capability bits is the most important fallback safeguard in the round. compileAsync coverage of post quads is unverified. *Improve:* Bound the variant manifest using sig-10's capped Look catalogue. Prewarm only at onIdle, in priority order. Feed the canary bits to the toy registry.
- P 3/keep: A first poke that stalls on a shader compile kills the payoff at exactly the moment we want a smile, so prewarming what is one tap away is a feel feature. *Improve:* Define 'one tap away' as the default tap plus the Play tray's first row, and measure first-poke latency in Couch Test.
- A 3/keep: A shader-compile hitch on the first poke is the worst motion bug a toy can have, and prewarming fixes it. *Improve:* Prewarm the Ink-to-Light edge pass and every Look graph. The poster-to-canvas swap must match exactly.
- Pr 4/keep: 'The first poke never compiles' protects the first minute directly (#33821), and the first-interactive-frame metric can be measured on v9 today. *Improve:* Report first-interactive-frame p50 and p95 in the telemetry events.
- M 4/keep: The first poke never hitches on compile, and the canary readback turns silent GL2 failures into capability bits. That is a real degrade signal, not a guess. *Improve:* Cap prewarm by device class, skip idle prewarm in LPM or when battery is low, and count its memory in P-11's ledger.

<a id="r2-port-as-toy-engine-07"></a>
## Phoenix: device-loss recovery that brings back the molecule, the camera and the look
`R2-port-as-toy-engine-07` · foundation · effort M · judges mean **3.2** (E3 P2 A3 Pr3 M5; keep 5) · self-scored fun 2 / visual 2 · perf neutral

> When the GPU device or GL context is lost, hold the last settled still, rebuild the renderer, and restore the canonical view, gist, bonds and Studio from CPU-owned state. Escalate calmly to the GL2 backend, then to a poster, without ever unmounting the panels.

**Framing:** problem->solution

**Builds on:** C001+C002+C042+C067+C106

**Problem:** In three r186 a lost WebGPU device is terminal: the default onDeviceLost only logs and sets _isDeviceLost, compileAsync returns early afterwards, and a device.lost with reason 'destroyed' is ignored (all source-read). On the GL2 fallback three calls preventDefault on webglcontextlost, but nothing restores the context. Lupi's surfaces only fail over: GPU Studio's onDeviceLost, gist, swirl and action-light via failureRef. Folding five devices into one (C001) means a single loss takes down the viewer, gist, bonds and Studio together. On phones, background tabs and GPU process resets make 'the molecule vanished' a real moment.

**Solution:**

(1) A GpuEpoch store holds {epoch, backend, lostAt[], reason}. The renderer factory sets renderer.onDeviceLost to: mark lost, stop the loop, show the loss poster.
(2) LOSS POSTER. At each C002 sleep, the capture service reads a downscaled frame (512 px or less, async render-target readback). That still is also the new viewer thumbnail, replacing captureViewerThumbnail's preserved-buffer path, which V2 breaks anyway.
(3) REBUILD. Explicitly dispose the old renderer (#3926 leaks until its fix lands); bump the Canvas key; the async factory requests a new adapter and device with the same requiredLimits; Warm Start compiles the current variant; re-upload source positions, palettes and occlusion bytes from the CPU-owned trajectory; restore camera, look and mood from the canonical view state (the same serializer as lupi.encode_view_url). Subscribers re-initialize when the epoch changes: gist via vgpu initFromDevice(renderer.backend.device), reseeded at its current phase; the GPU bond pipeline recomputes or falls back to the worker; Studio-as-Look re-initializes. The poster crossfades out. The fun layer resets to rest, since it is ephemeral by design, but the Replay Tape ring survives in JS memory, so 'share what I just did' still works.
(4) ESCALATION. A second loss within 60 s remounts with forceWebGL (the GL2 backend) and a quiet 'compatibility mode' note in the Style sheet. A third shows the static poster and a 'Restart viewer' button. Panels, switcher and sheet state never unmount, and the entrance animation never replays.
(5) HIDDEN TABS. Pause all GPU work on visibilitychange, and re-validate with the canary frame on return.
TEST (R11). WebGPU lane: CDP Browser.crashGpuProcess (experimental); alternatively destroy the device and call renderer.onDeviceLost with reason 'unknown', because three ignores 'destroyed'. Assert that viewer_state (camera, look, file, specId) deep-equals its pre-loss value, frames render, and no console errors appear. GL2 lane: WEBGL_lose_context.loseContext() and restoreContext(). An escalation test forces three losses.

**Experience:** Desktop and phone: after a GPU hiccup, or on returning to a backgrounded tab, the picture never goes blank. The last still holds, then the live molecule returns in the same pose and look. Keyboard: focus is preserved. Screen reader: aria-live 'Viewer restarted'. Reduced motion: a crossfade.

**Tech:** three r186 renderer.onDeviceLost and onUncapturedError; WebGPU device.lost; WEBGL_lose_context; CDP Browser.crashGpuProcess; vgpu 0.4.0 initFromDevice (end-to-end sharing UNVERIFIED); R3F v10 async renderer factory (guard against #3782 double invocation); canonical state from the lupi.encode_view_url serializer.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R12 (one device, factory), R9 (render-target capture for the still), R7

**v9 slice:** GL2 context-loss recovery for today's R3F 9 viewer (key remount plus state restore) and the settle-still thumbnail both ship on v9.

**WebGL2 fallback:** The webglcontextlost/restored path, then a remount on GL2. GL2 is also the first escalation step from WebGPU.

**Where in code:** packages/ui/src/viewer/ViewerCanvas.tsx; packages/ui/src/viewer/captureViewerThumbnail.ts:17-31; packages/ui/src/gpu-studio/runtime.ts:173; packages/ui/src/scan/gist/gistParticles.ts:106; packages/ui/src/action-light/runtime.ts:38-40; packages/renderer/src/pipeline/AtomPipeline.ts:422.

**Risks:** Browsers may block GPU access for an origin after repeated losses; the GL2 and poster steps cover that. Restoring must not re-trigger the entrance or double-count delight events. iOS memory-pressure tab kills are page reloads, not device loss, and Phoenix can't help there; Zero-Byte Play and the spike's caps do. The async factory double-invoke bug (#3782) could corrupt a rebuild.

**Honesty:** No recovery-time claim is made. The restored view is canonical state, and the fun state is deliberately not persisted, so nothing illustrative can leak into a saved view.

**Judges:**

- E 3/keep: Device-loss recovery was a real gap, and the v9 context-loss slice is cheap. Replacing preserveDrawingBuffer thumbnails with a settle-still is a good by-product, since V2 breaks the old path anyway. Remounting with the #3926 leak and escalating to forceWebGL add complexity. *Improve:* Share the poster and state machine with sig-08's Designed States. Take the still from capture-01. Make sure restore never re-fires the entrance or delight events.
- P 2/keep: A black canvas after a device loss is a hard 'this is broken' moment on phones. Recovery matters, but it is plumbing. *Improve:* Pair it with Designed States so the loss poster is the last settled still.
- A 3/keep: Holding the last settled still while the device recovers is the right visual behaviour. *Improve:* Use sig-08's specimen plate as the loss poster, so there is one visual for every non-happy state.
- Pr 3/keep: A trust feature, and its v9 context-loss slice is cheap. *Improve:* Share the loss poster with Designed States.
- M 5/keep: iOS drops GPU contexts on backgrounding and memory pressure. Holding the last still, restoring the view and escalating calmly (WebGPU → GL2 → poster) without unmounting panels is graceful degrade done right, and the v9 slice ships now. *Improve:* Share the visual with SM-08, announce 'Restoring view' once, never replay the entrance, and stop at the poster after two losses in a session.

<a id="r2-port-as-toy-engine-08"></a>
## Toy Cartridges: a lazy toy registry with per-toy byte budgets and an import wall that keeps toys out of three
`R2-port-as-toy-engine-08` · system · effort M · judges mean **3.6** (E4 P3 A2 Pr5 M4; keep 5) · self-scored fun 2 / visual 1 · perf improves

> Each toy is a small lazily loaded controller, declared in a static manifest of gesture claims, slot kinds, settle rule, still, real twin and gzip budget. Lint forbids toys from importing three or touching source data, so 30 toys can't bloat the ~1 MB viewer chunk, trigger compiles, or move a real atom.

**Framing:** problem->solution

**Builds on:** C001+C027+C041+C019+C094

**Problem:** Round 1 proposes about 30 toys. The viewer chunk is already about 1 MB gzipped, the ~176 KB WebGPU vendor chunk becomes mandatory, and Vite's 800 KB chunkSizeWarningLimit is the only guard. A toy that imports three or creates materials or kernels adds bytes, compile hitches and honesty risk: with access to source buffers, a toy can move source atoms.

**Solution:**

(1) MANIFEST: static, in the viewer chunk, about 150 B per toy: { id, verbs (gesture claims per D2's grammar), slotKinds, backend: 'both'|'gpu', settle: 'analytic'|'timeout', still: 'ring'|'crossfade'|'caption', illustrative: {label, realTwin?}, budget: {gzKB, dataKB}, prefetch: 'core'|'on-play-chip'|'on-verb', load: () => import('./toys/<id>') }.
(2) TOY API, the only module toys may import: slots (write Touch Field slots), twins (read display positions), pick (ID-patch results), motion tokens, seed(streamId), announce() (aria-live), cue() (C041 sound or haptic), invalidateUntil(t). ESLint no-restricted-imports on packages/ui/src/toys/** bans three, three/*, @react-three/* and the store's file setters. Toys therefore structurally can't create materials or kernels (so no compile hitch, and #32735-safe) and can't write source positions.
(3) SCHEDULER. The registry mounts each active toy's jobs in 'input' (gesture to slots) and 'update' (CPU twin, springs). No toy may use 'render' or numeric priorities, enforced by lint.
(4) CORE VS LAZY. RIPPLE and BURST/CONDENSE are core, because the entrance and the parity demo use them. Every other toy loads on the first use of its verb or when the Play chip opens, and is prefetched on scheduler onIdle after FIF unless Save-Data or Low Power Mode is on.
(5) BUDGETS IN CI. From Vite build.manifest and gzip sizes: each toy-* chunk stays within its declared gzKB (default 8 KB), and the viewer entry may grow by at most 2 KB per toy PR. Data assets (pluck modes, sound samples) have separate budgets and honour Save-Data.
(6) CAPABILITY GATING. The registry hides verbs whose canary bits failed and shows their still-only variant, so a GL2 visitor never meets a dead verb.
TEST (R11, both lanes). Open the Play chip and trigger each verb from a tape. Assert that each chunk is fetched once and within budget, that no new pipelines appear (the Warm Start instrument), and that still-mode is used under reduced-motion emulation.

**Experience:** Visitors never download 30 toys. The first time you hold to heat, the heat cartridge (a few KB) arrives in the gap before the long-press threshold. Keyboard: the registry publishes every toy's keys to the '?' help sheet and to the atom cursor's action list. Screen reader: the registry announces toy names and states consistently, rather than each toy doing it differently. Reduced motion: the registry enforces each toy's declared still.

**Tech:** Vite dynamic import, build.manifest and a manualChunks rule for toys/*; ESLint no-restricted-imports; @pmndrs/scheduler phases (0.2.0 on v9, v10 later); a gzip-size budget script.

**Backend:** DOM/CPU (ships on v9 today)

**Rides (v10 requirements):** R7 (phases), R11 (budget CI); R3 via the Touch Field

**v9 slice:** The registry, manifest, import wall and budget CI ship on v9, with the relay entrance and C021's flick as the first two cartridges.

**WebGL2 fallback:** Controllers don't depend on the backend. Canary capability bits hide [GPU]-only toys and substitute their stills.

**Where in code:** packages/ui/src/toys/ (new); apps/web/vite.config.ts (manualChunks); eslint.config.mjs; tools/check-bundle-budgets.mjs (new).

**Risks:** First-verb latency while a cartridge loads; prefetching when the Play chip opens covers most cases. Toys that genuinely need custom rendering (C067 scan particles, glyph shatter) become reviewed 'engine features' outside the wall. The manifest can drift from the gesture grammar unless both are generated from one table.

**Honesty:** The import wall makes 'source atoms never move' a compile-time property of toy code, and every manifest entry must name its illustrative label and, where one exists, its real twin.

**Judges:**

- E 4/keep: A lazy registry with an import wall (toys can't import three or touch source data) and gzip budgets in CI keeps 30 toys from bloating the ~1 MB viewer chunk, and makes the 'source atoms never move' rule lintable. It ships on v9. *Improve:* Use one ToyManifest type with play-11. Prefetch cartridges when the Play chip opens to hide first-verb latency.
- P 3/keep: Lazy toy chunks with byte budgets let the tray grow without slowing the first frame, which protects the first minute. Process. *Improve:* Host play-11's access fields and play-07's altActions, and prefetch cartridges when the Play chip opens.
- A 2/keep: Outside my lens. *Improve:* The manifest should declare each toy's visual class and its designed still.
- Pr 5/keep: The governance I want. Per-toy byte budgets stop 30 toys bloating the ~1 MB viewer chunk. The import wall stops toys touching source data, which makes the honesty rule structural rather than a convention. *Improve:* Ship it in Joy Ladder M0, with the flick and the relay as the first cartridges, sharing play-11's manifest.
- M 4/keep: Per-toy gzip budgets and an import wall protect cellular users and the ~1 MB viewer chunk. *Improve:* Merge its manifest with PE-11's (one ToyManifest). Budget chunks against P-12's byte classes, and never prefetch toy chunks on Data saver.

<a id="r2-port-as-toy-engine-09"></a>
## Parity Exit by Poke: a one-week phone gate spike that passes or fails on a ripple and a burst
`R2-port-as-toy-engine-09` · foundation · effort M · judges mean **4.2** (E5 P3 A3 Pr5 M5; champion 3, keep 2) · self-scored fun 2 / visual 1 · perf improves

> Widen the planned early-Z spike into a phone gate spike across old iPhones on the GL2 fallback, Low Power Mode, iOS 26 WebGPU and a mid-range Android. Its pass/fail criteria are a poke and a burst, and it produces the per-device caps every later hook uses.

**Framing:** problem->solution

**Builds on:** C014+C001+C004+C028+C030+C013

**Problem:** The planned gate spike measures early-Z loss on 'a phone and a laptop'. Round-1 judges asked for iOS 17/18 on the GL2 fallback, Low Power Mode, a mid-range Android, UnsignedByte output, and a pass condition you can see. No Lupi surface has real-device frame, latency, memory or thermal data, so the slot caps, velocity, byte layout and render scale would all be designed blind.

**Solution:**

SANDBOX: #/lab/impostor, the first deploy of the /next lane. It has TSL impostor tiers 0-2 with depthNode; the Touch Field with RIPPLE and BURST; toggles for UnsignedByte vs HalfFloat output, render scale 1 / 0.75 / 0.6, velocity MRT, reversed-Z and the scissored ID patch. Scenes: caffeine, C60, 100k Cu FCC, and 1M and 5M lattices, on C014's seeded tour.
DEVICE CLASSES (the owner picks the actual hardware): A, an iPhone on iOS 17 or 18 (GL2 fallback); A-LPM, the same phone in Low Power Mode; B, an iPhone on iOS 26 (WebGPU); C, a mid-range Android on Chrome 121+ with WebGPU; D, a laptop with an integrated GPU; E, a desktop discrete GPU for ceilings.
METRICS: frame-interval distribution (p50, p95, and hitches longer than 2x the median); poke latency, from 240 fps slow-motion video of finger and screen on A, B and C, with a software proxy of event.timeStamp to the rAF of the first displaced frame; early-Z loss for tier 2 at 1M and 5M, with and without a depth prepass; iOS memory (does 1M, 2M or 5M reload the tab?); a 10-minute thermal soak on the burst loop; GL2 program-count churn on r186 vs r187 (#34597); iPhone acceptance of requiredLimits (maxStorageBuffersInVertexStage); EXT_clip_control on A; vertex-stage textureLoad on A (needed by PLUCK).
ACCEPTANCE (parity-exit gates per class, with thresholds set from the D and E baselines; reported, not claimed): (1) Poke: the first displaced frame is the first presented frame after the input, no pipeline is created, and the ripple settles within its token time plus or minus one frame at 30, 60 and 120 Hz. (2) Burst: the authored timeline completes on wall-clock time plus or minus one frame, hitches stay at or below T, and the tab never reloads at the class's atom cap. (3) The Low Power Mode detector sees the locked 33.3 ms cadence within 30 frames on A-LPM and never fires on C under load.
OUTPUTS: a go/no-go for the WebGPU impostor; per-class caps (atoms, active slots, DPR, render scale, output buffer type) that seed C004's ladder; and the C013 visibility-buffer contingency, triggered only if early-Z loss fails on D.
TEST (R11): the spike's tour and its poke and burst tapes become permanent correctness tests in both lanes (SwiftShader timing is ignored). Device results go to a release-truth lane, not to CI.

**Experience:** Visitors see nothing directly; it is a lab route. The owner gets a one-page matrix and slow-motion clips of a finger poking caffeine on every class, which becomes the public 'it works on your phone' evidence at cut-over.

**Tech:** v10 canary triplet; three 0.186.1 plus an r187 dev build for the leak check; the TSL impostor; rAF and event timestamps; Safari Web Inspector timelines and chrome://tracing; WebGPU timestamp-query where granted; EXT_disjoint_timer_query_webgl2 on GL2.

**Backend:** mixed

**Rides (v10 requirements):** R3 (gate), R6 (output buffer type, render scale), R12 (limits), R11

**v9 slice:** C014's ?perf HUD and seeded tour run on v9 on the same devices beforehand, so the spike compares v9 WebGL with v10 on identical scenes.

**WebGL2 fallback:** Classes A and A-LPM exist to test the GL2 fallback and the old-iPhone double penalty.

**Where in code:** packages/ui/src/lab/ImpostorLab.tsx (new); tools/perf-tour.mjs (new); docs/gate-spike-report.md (new, owner-authored).

**Risks:** One week is tight for an XL impostor plus the field, so keep tiers minimal (no etch, one IBL). Devices may not be available. Slow-motion analysis is manual. One phone per class may not generalize. Thermal results depend on ambient conditions.

**Honesty:** This idea exists because there are no FPS numbers. Thresholds are relative to measured baselines, and results are published as a dated release-truth record, not as marketing.

**Judges:**

- E 5/champion: The mandatory gate made useful. It runs on named phone classes (iOS 17/18 GL2, the same phone in Low Power Mode, iOS 26 WebGPU, a mid-range Android), passes or fails on poke and burst, and outputs per-device caps every later hook consumes. One week is tight for an XL impostor plus the field. *Improve:* Budget two weeks or drop etch and tier 2 from the sandbox. Run C014's v9 tour on the same devices first so the comparison is like-for-like.
- P 3/keep: Passing the port on a poke and a burst on real phones is the acceptance test a playtester wants. It's a spike, not a toy. *Improve:* Add feel criteria (input-to-ripple latency, hitches per flick) next to the frame-time numbers.
- A 3/keep: Using a poke and a burst as the parity exit is good, but parity also has to mean the Looks look the same. *Improve:* Add sig-10 goldens and the 1M-lattice shimmer probe to the gate.
- Pr 5/champion: It de-risks the whole 4-5 month bet. It tests named device classes (an old iPhone on the GL2 fallback, Low Power Mode, iOS 26, a mid-range Android) and passes or fails on a poke and a burst. It is the only idea that can conclude 'don't port yet'. *Improve:* Have the owner commit to the no-go outcome in advance: a depth prepass, or staying on v9.
- M 5/champion: The first idea that produces real phone data: classes for iOS 17/18 on GL2, the same phone in LPM, iOS 26 WebGPU and a mid-range Android, with a poke and a burst as pass/fail. Every phone claim in both rounds is a guess until this runs. *Improve:* Add a 10-minute thermal soak and battery drain per class, a VoiceOver smoke pass, and output per-device caps (atoms, slots, render scale) as data consumed by PT-03, PT-05 and C004.

<a id="r2-port-as-toy-engine-10"></a>
## Deep Dive: pinch into a million-atom lattice until one atom fills the screen, with tight depth, reversed-Z and a floating origin only where the maths says so
`R2-port-as-toy-engine-10` · toy · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 4, rework 1) · self-scored fun 4 / visual 4 · perf neutral

> Replace today's generous clip planes and 22 Å minimum distance with a computed precision budget: per-frame near/far fitting, reversed-Z float depth and a floating origin for extreme scales. Then let people dive to a single copper atom, which becomes a planet with a crisp 'Cu' decal.

**Framing:** capability->problem

**Builds on:** C082+C021+C056+C046+C009

**Problem:** cameraMinDistance is max(0.5, 0.04 x cameraDistance), 22 Å for a 1M Cu lattice, so you can't dive to one atom. near is min(0.1, 0.002 d) and far is max(10000, 100 d, 20 x camDist), a near/far ratio of at least 1e5 on a standard depth buffer, so contact seams between touching impostors can shimmer at distance. Round 1's C082 Powers of Ten was sent back for rework over precision and vestibular risk.

**Solution:**

(1) PRECISION BUDGET, computed rather than guessed. Vertex jitter in pixels is about |p| x 2^-24 / (z x 2 tan(fov/2) / H). For Lupi's largest regular scenes (|p| up to about 2,300 Å for the billion-atom block), at z = 1 Å, fov 50 deg and H of about 1,055 px, that is about 0.14 px, so no floating origin is needed. It becomes necessary beyond about 1e4 Å (C082's micron stages).
(2) DEPTH. Turn on WebGPURenderer reversedDepthBuffer (float depth), and switch the impostor depthNode to viewZToReversedPerspectiveDepth (present in r186). On GL2 this needs EXT_clip_control; three checks for it and falls back with a warning. web3dsurvey reports about 99% support on iOS, unverified on our devices.
(3) DYNAMIC NEAR/FAR on every camera move. Intersect math's frustum.setFromViewProjectionMatrixSides (side planes only) with brick and chunk bounds (box3/obb3) to get near = max(1e-3, nearest visible bound - margin) and far = farthest visible bound + margin. Use the ZO or NO variants depending on renderer.coordinateSystem.
(4) FLOATING ORIGIN only when |p| > 1e4 Å: shift the world root by minus the camera position using f64 JS numbers, keep the camera near the origin, and shift the previous-frame matrices by the origin delta so Twin Velocity stays correct.
(5) THE TOY. Pinch, scroll, +/- keys or a Dive button zoom toward the atom under the finger (C021's dolly-to-cursor). minDistance drops to 1.5x the atom radius while Dive is on. Up close, the atom's element decal (C056 letters, crisp through R8 glyph) and its neighbours' names fade in. Fog (C046) is on by default above 50k atoms, so the lattice reads as depth layers. A 'Surface' button glides back out. Detents at atom, unit cell and crystal tick as you pass them, and a readout says 'You are 2.1 Å above a copper atom'.
TEST (R11, both lanes). Put the camera 0.5 Å above an atom of a 1M Cu lattice at a world offset of 2,000 Å, plus a synthetic stage at 1e5 Å. A 9x9 ID patch must match a CPU ray-sphere nearest-atom grid exactly. Two renders one ulp of camera motion apart must give identical ID patches (no flicker).

**Experience:** Desktop: scroll into the copper block, the seams stay crisp, and one atom becomes a planet labelled Cu; trackpad pinch works the same. Phone: pinch toward the finger, or use the one-thumb Dive button. Detents bound the motion, zoom never happens without input, and angular velocity is capped for vestibular comfort. Keyboard: +/- step between detents and Enter dives into the focused atom. Reduced motion: detent jumps with a crossfade. Screen reader: distance and neighbours through aria-live.

**Tech:** three r186 reversedDepthBuffer, viewZToReversedPerspectiveDepth and viewZToLogarithmicDepth (both present), EXT_clip_control (web3dsurvey data), renderer.coordinateSystem; math@0.1.0 shapes (frustum Sides/ZO/NO, box3, obb3) and time (spring3, dampAngle); R8 glyph for decals.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (depthNode), R5 (billion-atom block), R8 (decals), R12

**v9 slice:** Dynamic near/far fitting, a relaxed minDistance behind Dive, and the detents ship on v9 as pure TS in CameraManager and useViewerSceneModel. Reversed-Z waits for R3, because it would change the GLSL depth write.

**WebGL2 fallback:** Reversed-Z through EXT_clip_control when present, otherwise tight near/far only. The floating origin doesn't depend on the renderer.

**Where in code:** packages/ui/src/viewer/useViewerSceneModel.ts:37-48; packages/ui/src/app/CameraManager.tsx:28-45; packages/ui/src/viewer/ViewerCanvas.tsx:69-74; packages/scene/src/BillionAtomBlock.tsx.

**Risks:** Very close zoom exposes etch-texture resolution and shading at huge pixel footprints. The floating origin touches every consumer (labels, picker, trails). Too small a minDistance clips the near plane through an atom. The 'planet' moment tempts decoration inside the atom, which is forbidden (C059 was killed).

**Honesty:** Nothing is drawn inside the atom except the element decal. Radii keep the displayed vdW or covalent convention, labelled as such. The distance readout is real geometry.

**Judges:**

- E 3/keep: The precision budget is computed correctly (about 0.14 px jitter at 2,300 Å, so no floating origin is needed below ~1e4 Å). I verified reversedDepthBuffer in r186, with the GL2 backend falling back through EXT_clip_control. v9 dynamic near/far fitting is a free quality win. The 'dive to a planet atom' toy itself is modest. *Improve:* Ship near/far fitting as v9 hygiene. Switch the impostor depthNode to viewZToReversedPerspectiveDepth in R3. Defer the floating origin until micron-scale stages exist.
- P 3/keep: 'How far can I zoom?' is intrinsic curiosity, pinch is the most natural phone gesture, and today's 22 Å floor stops you short. But the payoff, one sphere with a Cu decal, is thin. *Improve:* Reward the end of the dive with a detent, a tick and a scale caption. Ship the v9 near/far fitting and relaxed minDistance now as a quick win.
- A 3/rework: The precision budget is solid infrastructure. But the payoff, one atom filling the screen as a planet, is a single shaded sphere at a huge pixel footprint, exactly where impostor shading, etch resolution and flat palette colour look cheapest. *Improve:* Keep the depth work. End the dive at a neighbourhood scale where the lattice pattern and Contact AO are the image, or design the close-up (rig catchlight, decal) as its own golden.
- Pr 3/keep: Pinching down to one atom is a wow on 1M-atom lattices, and near/far fitting is worthwhile v9 hygiene. But large lattices aren't the student starter set. *Improve:* Ship the v9 precision fixes now, and fold the dive into Six Sides' scale stages.
- M 3/keep: User-driven pinch zoom is acceptable, and the precision fix is sound, but diving across orders of magnitude is heavy optic flow. *Improve:* Stop at detents with a Next-step button and keys, cap any scripted glide per PE-10's zoom-rate rule, and use a still per stage under reduced motion.

<a id="r2-port-as-toy-engine-11"></a>
## Engine Spine: where math and the scheduler live, with GPU-mirrored motion tokens, seeded streams, ZO/NO frusta and one phase map
`R2-port-as-toy-engine-11` · foundation · effort M · judges mean **3.0** (E4 P2 A3 Pr3 M3; keep 5) · self-scored fun 2 / visual 2 · perf improves

> Four seams between CPU and GPU, each with a test: motion tokens evaluated identically by math/time and a TSL port of its coefficient map, per-feature seeded streams plus a bit-exact PCG hash, frustum conventions chosen per backend, and a lint-enforced phase table.

**Framing:** problem->solution

**Builds on:** C003+C002+C021+C062+C071

**Problem:** C003 and C002 fixed motion and idle on the CPU, but the port adds a GPU half: shader-side springs, hashes and frusta that must agree with the CPU picker, labels, velocity tests and analytic sleep. Without a spine, each toy re-derives spring maths in TSL, calls Math.random, picks the wrong clip convention (WebGPU is ZO, the GL2 backend NO), and registers numeric priorities that v10 silently runs in reverse.

**Solution:**

(1) MOTION TOKENS, TWICE. @atlas/core/motion exports tokens {snap, glide, float, boing, settle} as {smoothTime, dampingRatio}. The CPU uses math/time spring*.update. The GPU uses a 25-line TSL port of math's coefficients(): omega = 2/smoothTime, with the critical, under- and over-damped branches as uniform-coherent If blocks, evaluated at dt = t - t0 from an initial (displacement, velocity). It is the same linear map math applies per step, so shader envelopes and CPU springs trace one curve. settleTime(token, amplitude, epsilon), from the e^(-zeta omega t) envelope, drives invalidateUntil; this is the analytic settle helper round 1 asked for, which math lacks. motionScale scales every amplitude, and 0 means one still per action.
(2) SEEDED STREAMS. seed(streamId) builds a mulberry32 state from hash32(sessionSeed xor fnv1a(streamId)), so Remix, burst directions, gas clouds and daily puzzles never share a stream, and replays stay reproducible when one toy draws more numbers. GPU per-atom randomness uses three's PCG hash(), which is uint-only (source-read) and mirrored bit-exactly on the CPU with Math.imul. Only downstream trig can differ (math issue #48), so twin tests compare hashes exactly and positions with tolerances. Noise toys keep only the low 16 bits of the seed, matching math/noise.
(3) FRUSTA AND MATRICES. Use math/shapes frustum.setFromViewProjectionMatrixZO on the WebGPU backend and NO on GL2, chosen from renderer.coordinateSystem, for CPU label culling, Deep Dive's near/far fit and the ID-patch candidate set. Scratch tuples, zero allocation.
(4) PHASE MAP, one table enforced by lint. start: canvas target switch. input: pointer flush, frameTimedRaycasts, toy gestures to slots, DeviceMotion to the mood tilt. physics: a fixed-step accumulator only for rare stateful sims; closed-form toys need none. update: camera kernel (C003/C021), mood springs, trajectory progress, relay and twins, gist compute dispatch. A custom 'labels' phase after update at fps 20. render: the default render or the pipeline; export takes over only through the ExportManager state machine. A custom 'capture' phase after render: async readbacks are started, never awaited inside render. finish: previous-matrix update for velocity, the perf HUD, the CSS-variable mirror at fps 30, delight events. Lint bans numeric useFrame priorities, and phase 'render' outside two whitelisted files.
TEST (R11). vitest compares the TSL mirror with math/time at 200 random (token, dt) pairs through a test-renderer /webgpu compute readback (tolerance 1e-4). PCG CPU vs GPU must be bit-exact over 1e5 indices in both lanes. Lint rules have fixture tests. A scheduler test checks that an idle viewer commits zero frames after settleTime.

**Experience:** Invisible. Visitors feel it as one timing language across the DOM chip, camera glide, poke ripple and burst, identical at 30, 60 and 120 Hz, and as a phone that goes quiet after every settle. Reduced motion becomes a single global scale rather than per-toy code.

**Tech:** math@0.1.0: time (spring, the coefficients semantics), random (mulberry32), shapes (frustum ZO/NO/Sides, obb3); three r186 TSL hash, If, Fn and renderer.coordinateSystem; @pmndrs/scheduler 0.2.0 addPhase, before/after, fps, onIdle; ESLint custom rules.

**Backend:** mixed (CPU spine on v9; TSL mirror [GPU+GL2])

**Rides (v10 requirements):** R7, R3 (TSL mirror), R12

**v9 slice:** Tokens, settleTime, seeded streams, the PCG twin and the phase map all ship on v9 with scheduler 0.2.0. Only the TSL mirror waits for R3.

**WebGL2 fallback:** Identical: all maths is uniform-coherent. NO frusta are used on the GL2 backend.

**Where in code:** packages/core/src/motion/ (new); packages/core/src/play/; packages/ui/src/viewer/phases.ts (new); eslint.config.mjs; lib/spring.ts, CameraFocus.tsx and gistEngine.ts EASE (retired onto tokens).

**Risks:** math 0.1.0 is pre-1.0: pin it exactly and avoid canary-only helpers such as smoothstep and inCircle. Upstream could change coefficients() semantics, so the TSL mirror pins 0.1.0 behaviour with a golden test. Over-centralizing can slow toy authors; keep the API to tokens, seeds and phases.

**Honesty:** Twins are equal within stated tolerances; only integer hashes are bit-exact. No cross-browser bit-identity is claimed for anything that passes through trig.

**Judges:**

- E 4/keep: A lint-enforced phase table guards the brief's highest-risk silent failure: numeric priorities run in reverse and break capture without an error. Seeded streams and ZO/NO frusta per backend are correct hygiene. The TSL coefficient mirror overlaps port-03. *Improve:* Ship the phase lint and seeded streams in Phase 0, and move the TSL mirror into port-03.
- P 2/keep: Identical springs on CPU and GPU, plus seeded streams, make replays and shaders agree. Good plumbing with no visible fun. *Improve:* Fold it into the C003 motion-kernel package.
- A 3/keep: CPU and GPU tracing one spring curve gives consistent motion across DOM, SVG and 3D. *Improve:* Export CSS linear() easings from the same tokens (shared with sig-07).
- Pr 3/keep: Sound plumbing (mirrored tokens, seeded streams, a phase lint) that visitors never see. *Improve:* Land it inside the Touch Field and Replay Tape PRs rather than as its own project.
- M 3/keep: Mirroring motion tokens and motionScale on the GPU keeps reduced motion identical everywhere; otherwise engineering plumbing. *Improve:* Add comfort-class tokens next to motion tokens, so PE-10 caps are data, not scattered constants.

<a id="r2-port-as-toy-engine-12"></a>
## Replay Tape: one tiny seeded log of what you did, driving CI, Instant Replay, the touch-mark demo and bug reports
`R2-port-as-toy-engine-12` · system · effort M · judges mean **3.6** (E4 P3 A3 Pr4 M4; keep 5) · self-scored fun 4 / visual 3 · perf neutral

> The fun layer is closed-form in (t, slots, seed) and the camera is one spring kernel, so a few kilobytes of events and pose samples replay a session exactly. One format feeds the dual-lane tests, 'replay my last 6 seconds', the abstract touch-mark demo and a 'copy tape' bug report.

**Framing:** capability->problem

**Builds on:** C103+C019+C014+C062+C112

**Problem:** Every pitch in this plan needs a test in two lanes. Round 1's Instant Replay spark needs a frame-exact re-render of the last ~6 s. C019's demo needs scripted gestures. Phone bug reports amount to 'it glitched when I tapped'. Four separate recorders would get built, and screen recording from a WebGPU canvas on Safari is unverified.

**Solution:**

FORMAT lupi.tape.v1: JSON of about 2-6 KB for 6 s, containing {viewRef (saved-view slug or Remix code plus specId), seeds, t0, events: [{t, kind: poke|burst|heat|knife|flick|key, atomId or ndcXY, params}], camera: quantized (azimuth, elevation, distance, target) at 30 Hz, mood keyframes}.
RECORDING. A ring buffer holds the last ~10 s: events in the 'input' phase, pose in 'finish'. It costs no GPU work and holds no PII: atom ids, normalized coordinates, relative times, no free text.
PLAYBACK. frameloop 'never' plus scheduler stepping (or advance(t)) at a fixed dt. Events re-enter the SlotPool at their t, and the camera follows the samples through the glide token.
CONSUMERS. (a) CI: tapes are fixtures (poke-caffeine, burst-c60, first-minute, deep-dive-cu, device-loss) replayed in both R11 lanes and asserted through twins, ID patches and perceptual goldens; every other idea's exit test is a tape. (b) Instant Replay: after a burst or a spin record, a Replay chip re-renders the last 6 s frame-exact at a fixed size through the capture service (C103), labelled illustrative. (c) Touch-mark demo (C019 rework): a curated tape played with an abstract touch mark overlaid. (d) Bug reports: 'Copy tape' in the ?perf HUD puts the tape on the clipboard so developers replay the exact glitch. (e) Share: a 'watch my burst' link that carries a tape id only if storage ever gets a cost owner; the default is the rendered clip.
DETERMINISM RULES. Toys must use seed() and scheduler time: lint bans Math.random and Date.now in toys. The tape stores specId and refuses to replay if the source file changed.
TEST. The tapes are the tests, plus codec round-trip goldens and a determinism check that the same tape gives identical frame hashes within one lane.

**Experience:** Desktop and phone: after a satisfying burst, tap Replay to watch it again, cleaner (frame-exact, no dropped frames), then share the clip. Keyboard: R replays the last 6 s. Screen reader: 'Replay of the last 6 seconds, illustrative'. Reduced motion: the replay becomes a strip of key stills rather than a moving clip.

**Tech:** @pmndrs/scheduler stepping and R3F advance() on frameloop 'never'; v10 fixed-size output (width/height) or useRenderTarget; readRenderTargetPixelsAsync; Mediabunny or WebCodecs per C103, with its readback fallback; a JSON codec in packages/core with golden tests; ESLint bans in toys.

**Backend:** DOM/CPU (ships on v9 today); playback rendering [GPU+GL2]

**Rides (v10 requirements):** R7, R9 (capture), R11

**v9 slice:** The tape format, recorder and CI replay ship on v9 for the flick and the relay entrance, both replayable today. The Instant Replay clip ships on v9 through advance() and a fixed-size render target (C103's v9 slice).

**WebGL2 fallback:** Identical recording and playback; encoding follows C103's fallback chain.

**Where in code:** packages/core/src/tape/ (new); packages/ui/src/viewer/phases.ts; the capture service beside ExportManager; tests/ui/tapes/*.json; the ?perf HUD.

**Risks:** Determinism breaks if any code path reads Math.random or wall-clock time; the seed service and lint guard this. Tapes go stale when molecules or tokens change, so they carry specId and a token version. Scope could creep into a replay editor; don't build one. Sharing tapes as links needs storage with a cost owner.

**Honesty:** Replays and clips are illustrative outputs, never MCP artifacts or evidence, and they carry the illustrative label. Tapes contain no personal data and never alter source data.

**Judges:**

- E 4/keep: One small tape format that feeds CI, replays, touch-mark demos and bug reports is high leverage. Keyframes every 0.5 s bound drift. Determinism depends on removing every Math.random and wall-clock read from the play path, which the codebase has many of today. *Improve:* Make it the format behind capture-03 and flagship-13. Version the motion tokens. Add a lint against unseeded randomness in play code.
- P 3/keep: One tape feeding CI, Instant Replay, the touch-mark demos and bug reports is elegant reuse. The fun lives in capture-03. *Improve:* Host flagship-13's CI role, and keep tapes small enough to fit in URL fragments.
- A 3/keep: One tape format behind CI, replays and demos. It is not visual in itself. *Improve:* Tapes should drive sig-10's per-toy stills as well.
- Pr 4/keep: One format feeds CI, Instant Replay, touch-mark demos and bug reports, which makes it high-leverage infrastructure for the referral loop. *Improve:* Make it capture-03's codec, and version the token tables.
- M 4/keep: One tape drives CI replays (so the accessibility contract is testable), the demos and bug reports, and it holds no PII. *Improve:* Record the comfort setting and reduced-motion state in the tape for replay fidelity, and never record assistive-technology usage.
