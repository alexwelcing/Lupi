# Round 2 · The First Minute, Choreographed End to End

[← all round-2 ideas](README.md)

## Direction notes

KEY DECISIONS
- First molecule: Carbon-60, not caffeine. From the shipped file: 60 atoms on a 3.51 Å sphere, 90 bonds, 12 pentagons and 20 hexagons. No view direction is more than 22.7° from a 5- or 3-fold face axis, so every coast clicks.
  - Its silhouette is constant, so the match frame is robust at any pose.
  - Its breathing and pinch Raman lines (about 496 and 1469 cm⁻¹) are almost a 3:1 twelfth apart, so the pluck chord is musical.
  - Being all carbon, it keeps the palette seam small.
  - Caffeine runs as the second A/B arm (The Vanishing Ring). Its heavy atoms lie within 0.001 Å of one plane in the file, which gives it a different, observation-based climax.
- Owner call on /: one hero, still until touched. Hover is not touch. No tile lean, no idle sway, no sound on /, rAF only while a spring is live, zero canvases. The hero is a door: drag spins it, tap opens it. Plucking is withheld as the reward for entering.
- Exactly two seams, per the art director's C016 condition: the SVG View Transition morph, then the SVG-to-canvas crossfade plus inflate. The Canvas2D middle stage is dropped.

TENSIONS RESOLVED
- Condensation vs. match frame: one deformer takes a 'from' field. FLAT (the drawing) is used when a predecessor is on screen; GAS (a seeded signature cloud) is used for cold links and planar molecules.
- Arrivals carry no illustrative chip, argued as an exception. They are transitions under 600 ms that end on the data.
- 'Cancelable': input is never blocked, and a key completes the arrival. A touch does not cancel it, because the arrival is shorter than a flick.
- Tap meaning: a tap catches while the molecule is moving, pokes at rest, and does nothing on empty space. Double-tap and long-press are left out of the minute (D2 owns them). The burst is the second-minute hook, not part of the first minute.
- Sound stays off by default, respecting clickSound's existing stance. It is unlocked by a '♪ Hear it' chip after the first pluck. That direct DOM tap is also the only legitimate iOS haptic and audio-unlock moment. The silent switch is left alone.
- Instant Replay is event-sourced: an input log plus keyframes, about 1 KB for 6 s. That enables 'Your Turn' replay links in the URL fragment, with no storage and no video, and gives the recipient their own designed minute.
- Reduced motion is a separately authored storyboard of stills: mode diagrams, an exploded plate, and a contact-sheet share. It is not 'skip'.

FINDINGS FROM THE CODE THAT SHAPE THE MATCH FRAME
- The preview SVGs use a sheared oblique projection, not a rotation.
- Their palette is not the viewer's CPK.
- Their highlight sits upper-left (30%/25%), while the viewer's key light (azimuth 40°, elevation 45°) lights upper-right. The half-vector puts the viewer's highlight near 63%/30%.
- Backdrops jump from #101817 to #020204 (splash) to the light figure plate.
- The fix is a render-calibrated SVG: offline sampling from the real viewer, a world-fixed-light emulation via gradient fx/fy, the same radius function, and a Sage plate, all guarded by a CI golden.

OTHER FINDINGS
- The PII regex in track.ts silently drops keys like 'chip', 'tip', 'fluid', 'guid' and 'molecule_name'. The telemetry idea therefore pins every key in a test.
- 37 octaves down puts C60's breathing mode near 108 Hz, below what phone speakers reproduce, so the cue sheet uses 36 octaves (about 216 and 641 Hz) and states it in the caption.
- Safari ignores overscroll-behavior-x for back-swipe (WebKit 240183), and it reports trackpad pinch as GestureEvent, not ctrl+wheel. So the hero never binds two-finger scroll on /, and the viewer handles both pinch paths.

v9 VS. POST-R3
Almost the whole arc ships on v9 with no new GLSL:
- the orbit kernel, detents, prefetch and relay;
- a flattened-frame inflate on the existing uProgress hook;
- poke torque with a mode-arrow overlay;
- the cue sheet, touch mark, replay, links, telemetry and contract test.
After R3 and R4 the arc adds per-atom stagger and overshoot, the real baked pluck and crisp ripple, bonds on pairs, ID-patch picking, compileAsync prewarm, demand frames with sleep, and deformer replay.

DELIBERATELY LEFT OUT
- Gist particles or any live canvas on /.
- Tilt and shake, which need a permission prompt.
- The burst, the Daily and AR Quick Look inside the first 60 s. They are later hooks.
- The rev/s readout, cut as the art director asked.
- New Looks.
- Any FPS claims. All storyboard seconds are hypotheses for the telemetry to test.

<a id="r2-first-minute-flagship-01"></a>
## The Buckyball Minute: one authored path from a still SVG on / to a sent replay
`R2-first-minute-flagship-01` · flagship · effort L · judges mean **4.0** (E3 P5 A4 Pr4 M4; champion 1, keep 3, rework 1) · self-scored fun 5 / visual 4 · perf improves

> A stranger spins a still SVG buckyball on /, taps it, watches that same drawing puff into 3D under their thumb, plucks it and hears its breathing modes, then sends a frame-exact replay of what they just did. It is one continuous minute with no dead splash and no text pill, and each beat adds one new verb.

**Framing:** problem->solution

**Builds on:** C015+C016+C030+C021+C028+C073+C041+C019+C103+C002+C009+C027

**Problem:** Round 1 found the right parts (C015 hero, C016 prefetch, C030 condense, C021 flick, C028/C073 tap, C041 cues, C019 hint, C103 loops), but they arrive as separate features with contested gestures and visible seams. Today a stranger's path breaks in four places, all checked in code. (1) There is nothing to touch on /. (2) A click runs openLocalMolecule, and LandingShell's store subscription then calls mountViewer, which does root.render(<Splash/>): the thing they touched is replaced by a black #020204 pulsing 'Lupi' while about 1 MB of viewer downloads. (3) The viewer opens on a light pub-figure-neutral plate (#f5f7fa to #dfe5eb) with a different pose, palette (CPK O #ff0d0d against the preview's #ed927e) and light side from the thumbnail they tapped. (4) The only teaching is a text pill ('Drag to rotate · Pinch to zoom · Tap an atom'). Nothing in the viewer answers a tap with feel or sound, and nothing turns play into something shareable. MOLECULE_INTERACTED fires on OrbitControls onStart, and nothing else measures the minute.

**Solution:**

FIRST MOLECULE: Carbon-60 (c60_buckyball). From the shipped file: 60 atoms on a 3.51 Å sphere, 90 bonds, 12 pentagons, 20 hexagons. Chosen for playability:
(a) Its silhouette is the same from every angle, so no rest is ugly, and no edge-on pose can spoil the SVG-to-3D match.
(b) Its pentagon and hexagon face-on axes cover the sphere densely. Computed from the file, no view direction is more than about 23° from one, so with a 24° capture every coast ends with a click on a composed view.
(c) It has the most readable pluck in chemistry: the totally symmetric breathing mode swells the whole cage in phase. The textbook Raman lines near 496 cm⁻¹ (breathing) and 1469 cm⁻¹ (pentagonal pinch) sit about an octave and a fifth apart (22 cents flat of 3:1), so the chord sounds musical.
(d) Condensing and bursting read beautifully on a cage.
(e) 60 circles plus 90 lines is cheap SVG.
(f) An all-carbon molecule keeps the palette seam small while the house-palette call is open.
(g) Its curated prompt ('Rotate the carbon cage. Look for different polygon shapes.') is answered by the detents themselves.
Cost: it is less colourful and less famous by name than caffeine, so the caffeine 'Vanishing Ring' arc runs as the other A/B arm. Returning visitors get the Daily hero.

OWNER CALL ON / (recommended): one hero, still until touched.
- Hover is not touch. On hover the cursor becomes 'grab' and a static lime ↻ glyph brightens; nothing moves.
- No tile lean, no idle sway, no sound on /.
- rAF runs only while a spring is live. The box is fixed-size, so there is no layout shift. There are zero canvases.
- The hero is a door: drag spins it, tap opens it. Plucking is the reward for walking through.

STORYBOARD, PHONE (one hand, portrait):
- 0 s: / paints. A 148 px C60 sits beside the two-line H1, still at the manifest hero pose, lit from the viewer's own key light. Below it are the ↻ glyph and an 'Open in 3D' link.
- ~2 s, horizontal thumb swipe on the hero: the cage turns 1:1. touch-action: pan-y keeps vertical scrolling for the page, and a 24 px left-edge dead zone leaves iOS back-swipe alone. Highlights slide across the spheres because the light is world-fixed.
- ~3 s, release: it coasts on the shared orbit kernel and clicks into the nearest symmetric azimuth. The glyph flashes 'hexagon' for 1 s. This first completed spin (30° or more) starts a low-priority prefetch, unless Save-Data or 2g is set.
- ~5 s, tap (8 px or less of travel) on the hero or the link: the hero's own vector SVG morphs to full screen over the Sage plate (a same-document View Transition, 280 ms, 'glide' token). The pose and any remaining spin carry over.
- 5 to 6.5 s: the relay stage. The full-screen SVG stays live and thumb-spinnable. After 1.2 s a hairline ring traces around the cage; the screen is never dead.
- ~6.5 s: the first validated canvas frame appears under the stage at the baton pose, with atoms flattened into the view plane and a narrow FOV, so it matches the SVG. A 120 ms crossfade follows, and the drawing gains real speculars and AO. Then comes the inflate (450 ms or less): front atoms come forward, bonds become cylinders, and the camera dolly-zooms to the default FOV at constant centroid scale. This plays on the first open per session only, and input stays live throughout.
- ~7.5 s: viewer chrome fades in 300 ms after settle. There is no pill, because spin was learned on /.
- 8 to 15 s, flicks: coast and clicks onto pentagon or hexagon face-on views, labelled at rest. Android vibrates 6 ms on each detent; iOS has no drag haptics. A tap during a coast catches it dead.
- ~15 s: if no atom has been tapped and the molecule has rested 4 s, the lime touch mark lands on the front atom and presses twice. The molecule does not move. aria-live says 'Tap an atom'.
- ~17 s, tap an atom at rest: after R3 the cage rings in its baked modes, with an '×N · illustrative' chip. On v9 the cage flinches away and boings back, a DOM ring ripples out, a 'C · carbon · atom 17 of 60' card appears, and mode arrows show. A '♪ Hear it' chip rises in the thumb zone.
- ~20 s, tap '♪ Hear it': this direct DOM tap unlocks audio, legitimately fires the iOS switch haptic, and vibrates on Android. The pluck replays with its chord (about 216 Hz and 641 Hz at 36 octaves down) and a caption. Sound stays on for the session behind a visible mute chip.
- 20 to 40 s: free play. A whoosh scales with flick speed, detents tick, and catches thud. Every cue has a visual twin.
- ~35 s: a 'moment' (a flick over 1 rev/s that ends on a detent, or three plucks in 4 s) raises a '↺ Replay' chip for 8 s.
- ~40 s, tap Replay: a 9:16 sheet re-performs the last 6 s live from the input log while the encoder renders it frame-exact.
- ~48 s, tap Send: it enables once the MP4 File exists, then opens the native share sheet with the clip plus a replay link.
- ~55 s: a quiet 'Next: caffeine →' card.

STORYBOARD, TRACKPAD (MacBook):
- 0 s: a 320 px hero sits right of the H1. On hover the cursor becomes 'grab' and the glyph brightens.
- ~2 s, click-drag (or three-finger drag): it spins; release coasts to a detent. Two-finger scroll over the hero scrolls the page and is never hijacked. That also avoids the Safari horizontal-swipe back navigation, which overscroll-behavior-x cannot stop (WebKit 240183).
- A hover dwell of 150 ms starts the prefetch.
- ~5 s, click: the View Transition runs.
- ~6 s: crossfade and inflate.
- 7 to 15 s: two-finger swipe orbits. Fractional wheel deltas mark it as a trackpad; the OS momentum tail is the coast, and when the stream ends the kernel springs to the detent. Click-drag also flicks. Pinch zooms toward the cursor: ctrl+wheel in Chrome and Firefox, GestureEvent scale in Safari. A Safari twist rolls, then springs upright. A mouse wheel (line deltas) still zooms.
- ~15 s: the cursor-form mark appears: 'click · or press Space'.
- ~17 s: click an atom to pluck it, then click Hear it.
- ~35 s: Replay offers 1:1 or 9:16. Copy link is primary, with Download MP4 and Share where navigator.share exists.
- ~50 s: pasted in Slack, the link unfurls with a card at the replay's start pose.

SEAMS: exactly two (the C016 art-director condition): the SVG morph, then the SVG-to-canvas crossfade plus inflate. There is no Canvas2D middle stage.

SPLIT:
- v9, before the port, with no new GLSL: hero SVG on the shared orbit kernel; symmetry detents; intent prefetch; the relay stage replacing Splash; the baton handoff into the C021 kernel; the flattened-frame inflate on the existing uProgress hook (uniform, no stagger, clamped so no overshoot) plus a camera dolly-zoom; poke torque with ring, card and mode arrows; the touch mark; the cue sheet and Hear-it chip; Instant Replay of camera, arrival and overlays via advance(), a fixed-size target and Mediabunny; replay links; telemetry; the contract test on the WebGL lane.
- After R3/R4 (plus R6, R7, R9, R11): per-atom stagger and overshoot in the TSL positionNode; the real pluck from a baked mode buffer, with C028's crisp ripple on unbaked molecules; bonds following via pair attributes; 9×9 ID-patch picking; compileAsync prewarm during the relay; demand frameloop and onIdle sleep after settle; the replay re-rendered through R9 fixed-size output on both backends, with deformer events replayed closed-form; a glow-byte flash on each detent.

EVENTS: time-to-first-rotate, first poke, sound opt-in, replay opened, first share and dead taps (see First-Minute Telemetry). The seconds above are design targets that those events will check; they are not measurements.

**Experience:**

DESKTOP (trackpad or mouse): the hero sits still until you grab it. Click-drag spins it and it clicks into a hexagon. A click opens it full-window with no cut. Two-finger swipes orbit and coast into detents, a click rings the cage, and you copy a replay link.
PHONE: a thumb swipe spins the tiny cage while vertical swipes still scroll. A tap swells it to full screen, still spinning under your thumb, until it is glossy and solid. Flick, tap, 'Hear it', Replay, Send.
KEYBOARD: Tab to the hero announces 'Carbon-60, 60 atoms. Arrow keys turn it between symmetric views; Enter opens it in 3D.' Arrows step between detents (each announced). Enter opens it, and the arrival is announced as 'Carbon-60 open in 3D, pentagon face-on'. In the viewer, arrows step detents, Space plucks the focused atom (D2's atom cursor), H toggles sound and R opens Replay.
SCREEN READER: every beat has a polite aria-live line, and the pluck caption names the mode.

**Tech:** math@0.1.0: spring.update, spring.fromResponse, spring.dampAngle, spherical. Plain rAF on /, with no fiber or scheduler in the landing chunk. Same-document View Transitions (Chrome 111, Safari 18, Firefox 144; https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available) with a FLIP fallback. modulepreload. v9: R3F 9 advance(), the existing uProgress interpolation (AtomsOptimized.tsx:367, bondImpostor.ts:56-57), WebGLRenderer readRenderTargetPixelsAsync, Mediabunny/WebCodecs. After the port: TSL positionNode and mode buffers (useBuffers), R4 bond pairs, useRenderPipeline, @pmndrs/scheduler phases with demand and onIdle, R9 fixed-size output, renderer.compileAsync. Web Audio. Web Share Level 2.

**Backend:** mixed: DOM/CPU on / and in the relay; [GPU+GL2] in the viewer after the port

**Rides (v10 requirements):** v9 slice: none (the existing uProgress hook). Post-port layer: R3, R4, R6, R7, R9, R11

**v9 slice:** The whole arc except per-atom stagger and overshoot and the real atom pluck. On v9 the pluck beat is the camera-only poke torque plus mode-arrow overlay and chord. The replay covers camera, arrival and DOM overlays. All of it is TS, DOM and uploads to existing attributes; none of it is GLSL that the port would discard.

**WebGL2 fallback:** Every post-port piece is [GPU+GL2]: closed-form deformers in positionNode, RGBA8 ID picking, fixed-size readback. On iOS 17/18 (GL2 backend) the arc is identical. In Low Power Mode (30 Hz rAF) the analytic kernel keeps the same settle times, and cues are scheduled on AudioContext time. With no WebGL at all, the relay stage becomes the SVG Pocket view with honest copy, and the minute still ends in a replay link and a contact sheet instead of a video.

**Where in code:** packages/ui/src/landing/LandingPage.tsx (hero next to #home-title); new packages/ui/src/landing/PocketHero.tsx; apps/web/src/main.tsx (Splash, mountViewer); packages/ui/src/LandingShell.tsx; landing/MoleculeWall.tsx and MoleculeFinder.tsx (openLocalMolecule); new packages/ui/src/motion/{orbitKernel,relay,tapRouter,verbLadder,cues}.ts; app/ViewerScene.tsx (OrbitControls at :731, MOLECULE_INTERACTED at :746); app/ViewerGestureHint.tsx; scene/src/AtomsOptimized.tsx (uProgress at :1576); scene/src/bondImpostor.ts; ExportManager.tsx; tools/build-gallery-previews.mjs and tools/build-student-previews.mjs; analytics/events.ts; tests/ui/student-surface.spec.ts plus a new first-minute.spec.ts

**Risks:** (1) The owner has not approved motion on /. Keep a 'hero off' arm measurable. (2) C60 is abstract to some strangers; the caffeine arm covers that. (3) The relay depends on an imperative node surviving root.render, and on View Transition snapshot timing during the root swap. (4) The iOS 26.5 direct-tap haptic behaviour comes from library-author reports and is unverified. iOS sometimes sharing an MP4 as text is also unverified. (5) Encode time on old phones is unmeasured, so Send may wait. (6) R7's reversed numeric priorities can silently break the replay encoder, so use named phases only. (7) A per-molecule 'up' vector changes what the top and side presets mean for curated molecules. (8) Every second in the storyboard is a hypothesis.

**Honesty:** Source atoms never move. On v9, arrivals change only what the GPU interpolates for 450 ms or less; store coordinates, picking and export use the true frame, and export waits for settle. After R3, all play lives in the offset layer. The pluck shows an '×N · illustrative' chip, the mode's method and version, and the octave transposition. The replay carries a corner 'illustrative' mark and an end card reading 'real coordinates · motion illustrative'. Symmetry labels are computed from the file with a stated tolerance. The arrival carries no chip; the exception is argued in Arrival Router. Nothing from the fun layer enters V1 or V2 artifacts.

**Judges:**

- E 3/keep: An umbrella storyboard over ~12 separately scored parts. The C60 choice is sound: I checked that no view is more than ~22.7° from a 5-fold or 3-fold axis, so every coast lands on a composed detent. The 'effort L' label hides that the pluck beat needs C073's xtb bake plus R3, and the replay beat needs the capture service. *Improve:* Treat it as the storyboard that flagship-13's contract test enforces, not as a build ticket. Absorb flagship-14 as the caffeine/search arm. Cut each beat to what its component already ships on v9.
- P 5/champion: The only idea that designs the seams. A thumb spin on / carries into the viewer, the coast clicks into a composed view, then comes a pluck and a send. C60's dense 5- and 3-fold views mean every coast ends on a picture, which is the 5-second smile. Weak points: C60 is all grey carbon, so the wow is shape rather than colour. The v9 pluck is only camera torque plus arrows, a thin payoff for beat 4. A hero that stays still until touched, with only a ↻ glyph, risks never being touched. *Improve:* A/B C60 against caffeine on time-to-first-rotate. Use Mode Harp's v9 extremes trick as the v9 pluck so beat 4 really rings. Give the hero one non-motion affordance (the glyph brightens once when scrolled into view). Cut the storyboard to the verbs strangers actually use in Couch Test.
- A 4/keep: The best-authored arc in the round. The hero doesn't move on hover, highlights stay world-fixed, a narrow-FOV dolly carries into the inflate, and chrome appears only after settle. Two problems: it answers the SVG-to-3D seam with a shaded SVG plus inflate while sig-06 answers it with Ink-to-Light, and C60 on the Sage plate is a grey ball, the least colourful first image available. *Improve:* Host the arc, but make the seam sig-06's Ink-to-Light with FLAT inflate from fm-04. Keep C60 only if the Specimen palette gives carbon a warm neutral with a clear catchlight, and A/B it against fm-14 caffeine on first-image appeal as well as playability.
- Pr 4/rework: This is the right shape: an authored minute from / to the first share is the activation program. But it replaces the owner's reset decision (docs/product-reset-2026-09-04.md: the home page opens on Water first) with C60 without saying so. It also assumes the owner approves motion on /, which they have not. At effort L it bundles about 12 components whose seams have never been measured. *Improve:* Treat it as the program storyboard, not one build item. A/B Water (today's control) against C60 and the caffeine arc, using flagship-12 events. Ship the components as separate PRs in Joy Ladder order.
- M 4/keep: The arc is well sequenced and gives every beat a keyboard line and an aria-live line. Prefetch honours Save-Data and 2g, and the analytic kernel keeps settle times at 30 Hz in Low Power Mode. But its reduced-motion minute lives entirely in FM-11, pluck haptics are only legitimate on iOS as DOM taps, and motion on / still needs an owner call. *Improve:* Ship FM-11 as a required twin in the same PR series. Keep a 'still hero' arm on /, cap coast angular speed via PE-10, and route every haptic beat through a DOM control (P-03).

<a id="r2-first-minute-flagship-02"></a>
## Match Frame Kit: the SVG is a render-calibrated twin of the first 3D frame
`R2-first-minute-flagship-02` · look · effort M · judges mean **3.2** (E3 P3 A4 Pr3 M3; rework 1, merge 4) · self-scored fun 3 / visual 5 · perf neutral

> One hero-pose manifest and a render-calibrated SVG builder make the home drawing and the first 3D frame identical in pose, palette, scale, light and backdrop, so the seam reads as the material getting richer rather than as a cut.

**Framing:** problem->solution

**Builds on:** C016 (match-frame condition) + C015 (speculars follow the key light) + C049/C106 (one visual voice across surfaces)

**Problem:**

Checked in code, the SVG-to-3D seam mismatches on five axes, so a FLIP between the two is a cut dressed up as a transition.
1. Pose: tools/build-*-previews.mjs uses a sheared oblique projection (px = 0.94x + 0.34z, py = 0.94y − 0.34(0.94z − 0.34x)), which is not a rotation. The viewer opens along +z via fitCameraForState.
2. Palette: the preview uses C #94aaa0, O #ed927e, N #81a9ed; the viewer's element colours are Jmol CPK (C #909090, O #ff0d0d, N #3050f8).
3. Light: the preview gradients put the highlight at 30%/25%, upper-left. The viewer's key light (azimuth 40°, elevation 45°, world-fixed) comes from upper-right-front, and the Blinn half-vector puts its highlight near 63%/30%.
4. Scale: preview radii are a hand-set scale × 0.34 (0.2 for H), not the viewer's resolveTypeDisplayRadius.
5. Backdrop: the landing is #101817, the preview rect is #101a18, the Splash is #020204, and the viewer default is the light pub-figure-neutral plate (#f5f7fa to #dfe5eb). That is dark, then black, then light.

**Solution:**

1. HERO-POSE MANIFEST (tools/hero-poses.json, emitted into gallery/previews.json). Per molecule: {up, az, el, fitFraction, detents[], planar}. It is authored for the 12 curated molecules plus the quick picks; everything else defaults to its principal-axes pose. The SVG kernel and the viewer's orbit kernel both read it. For C60, 'up' is a 5-fold axis; the nearest one in the file sits 17.7° off +Y, so the file orientation alone is not composed.
2. TRUE PROJECTION. The builder and the live SVG use a real turntable rotation about 'up' with an orthographic projection. The viewer's first frame uses the same direction with a narrow FOV (about 12°) at the distance that gives identical centroid-plane scale, d = h / (2·tan(fov/2)). During the inflate it dolly-zooms to the default FOV while holding the centroid scale constant. This is camera-only; on a featureless plate it reads as the object gaining depth, not as a vertigo shot.
3. RENDER-CALIBRATED COLOUR. An offline Playwright job (tools/build-match-frames.mjs) renders each manifest molecule at its hero pose in the real viewer. It samples per-element base, highlight and rim colours plus a depth-darkening curve (standing in for AO and fog), and writes those as the SVG gradient stops. The SVG is sampled from the 3D, not hand-picked. Re-run it whenever the default look, tone mapping or backend changes. When R6 loses N8AO the seam re-calibrates instead of drifting, so it survives the port.
4. WORLD-FIXED LIGHT IN THE SVG. The live SVG updates each element gradient's fx/fy every frame from the key-light half-vector in view space. Highlights slide across the spheres as the molecule turns, exactly as they do when the viewer's camera orbits under world-fixed lights. That is one gradient per element, so 5 or fewer attribute writes per frame (1 for C60).
5. RADII AND BONDS. SVG r and stroke width come from @atlas/core resolveTypeDisplayRadius, the function cameraFit.ts already uses, and from the viewer's bond radius. Atoms and bond midpoints are painter-sorted together so bonds occlude correctly, and bonds get split colours as in the viewer.
6. ONE PLATE. The stranger path opens on a 'Sage plate' gradient (#192522 to #101817), which is the landing's own --home-panel and --home-bg. The SVG rect uses the same colours. Owner call: make Sage the interactive default and keep Figure Neutral as the print and export preset (MCP sets its own), or scope Sage to arrivals from /.
7. ONE PALETTE FILE, consumed by the SVG builder, the viewer's 256-entry palette texture (a 1 KB upload) and the DOM chips. Recommendation: the calibrated student palette becomes the default 'Lupi element' palette, with 'Classic CPK' one tap away. C60 is all carbon, so the flagship does not depend on this call.
8. GOLDEN TEST. CI renders the SVG with resvg and captures the first 3D frame (WebGL lane now, both R11 lanes after the port). It asserts disc centroids within 1 px at 400 px, disc radius within 3%, per-disc mean colour ΔE2000 below 6 and backdrop ΔE below 2.

**Experience:**

DESKTOP: click the hero and you can't find the cut. The drawing just gains real speculars and depth, and the highlight is on the same side it was on the home page.
PHONE: the drawing under your thumb becomes the 3D cage with no grey flash, no black splash and no colour jump.
KEYBOARD and SCREEN READER: nothing changes for them. The SVG keeps role=img, and its <desc> keeps the source SHA and 'lines are distance-inferred guides'. The arrival announcement names the same pose the hero announced.

**Tech:** math@0.1.0 spherical, spring. SVG radialGradient fx/fy. @atlas/core resolveTypeDisplayRadius. Playwright for offline sampling (v9 readPixels on a preserveDrawingBuffer canvas; readRenderTargetPixelsAsync after the port). resvg for goldens. Palette texture upload (existing 256-entry palette path). A new gradient preset in tools/lupi-publication-backgrounds.json.

**Backend:** DOM/CPU (plus viewer camera and palette state; the calibration job runs per backend after the port)

**Rides (v10 requirements):** none on v9; re-calibration after R6 and R12; the golden runs in the R11 lanes

**v9 slice:** All of it: builder and projection changes, the manifest, live gradient fx/fy, the narrow-FOV first frame and dolly-zoom, the Sage plate, and the golden in the WebGL lane.

**WebGL2 fallback:** The calibration samples both backends. If the GL2-backend first frame differs beyond tolerance, the manifest stores two small stop sets. The page on / picks between them with a cheap `'gpu' in navigator` probe, without requesting an adapter.

**Where in code:** tools/build-gallery-previews.mjs:48 (oblique projection), tools/build-student-previews.mjs, packages/ui/src/gallery/previews.json, apps/web/public/learn/*.svg, packages/ui/src/cameraFit.ts, packages/core/src/elements.ts (palette source), packages/ui/src/SceneLighting.tsx:76-123 (key light), packages/ui/src/store.ts:929-961 (cameraFov, backgroundPreset, keyLight defaults), tools/lupi-publication-backgrounds.json, landing/student-home.css:1-13, new tools/hero-poses.json and tools/build-match-frames.mjs, new tests/ui/match-frame.spec.ts

**Risks:** SVG cannot reproduce IBL or screen-space AO, so the tolerances must be tuned. A per-molecule 'up' changes what the top and side presets mean for curated molecules. Changing palettes is a brand and classroom call, since teachers expect CPK. The calibration job must be deterministic in CI. A dolly-zoom is a vestibular cue if the backdrop has texture, so restrict it to flat plates.

**Honesty:** The SVG stays a projection of the real coordinates, with the source SHA in <desc>. Calibration changes only colours, never positions. The 'lines are inferred guides' note is kept.

**Judges:**

- E 3/rework: The hero-pose manifest is useful. Per-backend render-calibrated SVG gradient stops, stored twice for WebGPU and GL2 with resvg goldens, is a lot of calibration machinery for a seam that lasts under 600 ms. SVG cannot reproduce IBL or AO anyway, so tolerances will be hand-tuned forever. *Improve:* Keep the manifest and one shared projector (the same one capture-05 and sig-06 use), and cover the seam with a short crossfade. Drop per-backend calibration and the two stop sets.
- P 3/merge: Invisible when it works, which is the point: object permanence across the seam makes the stranger believe it is the same thing they were holding. It is art-direction tooling, not play, and SVG can never match IBL or AO. Host: R2-first-minute-flagship-01. *Improve:* Make it the flagship's match-frame acceptance criterion, and calibrate only the hero molecule(s) at first rather than all 12 curated molecules plus the quick picks.
- A 4/merge: Host: R2-signature-and-moonshots-06. The hero-pose manifest (a composed 'up' and fitFraction) and the constant-scale narrow-FOV dolly are right, and the per-disc ΔE golden is a real standard. But faking IBL and AO with radial-gradient stops chases the 3D and will look like clip-art spheres at 148 px. sig-06 flips the problem (the 3D starts as the drawing), which is more distinctive and more robust. *Improve:* Merge into sig-06. Keep the manifest, the dolly-zoom and the golden test, and drop the render-calibrated gradient stops.
- Pr 3/merge: Merge into R2-signature-and-moonshots-06. The hero-pose manifest has real leverage, because cards, /m pages, detents and the Daily can all share one pose. The render-calibrated SVG, though, polishes a seam nobody has measured yet. A per-molecule 'up' also quietly changes what Top and Side mean for saved views. *Improve:* Fold the pose manifest into Ink and Light's shared projection. Version the camera presets so saved views keep their meaning.
- M 3/merge: Merge into FM-01. Calibration is lens-neutral; its accessibility value is removing the luminance jump and black flash at the SVG-to-3D seam. *Improve:* Fold into FM-01/FM-03 and source SVG and first-frame colours from SM-01 tokens, so the seam never changes contrast or brightness abruptly.

<a id="r2-first-minute-flagship-03"></a>
## Relay Baton: one orbit kernel on both sides of the load, and no dead splash ever
`R2-first-minute-flagship-03` · system · effort M · judges mean **3.8** (E3 P4 A4 Pr4 M4; keep 5) · self-scored fun 4 / visual 4 · perf improves

> The landing hero and the viewer camera share one pure-TS orbit kernel. The tap hands over a baton (az, el, angular velocity, time) that the 3D camera picks up mid-spin. Meanwhile an imperative relay stage keeps the SVG live and playable through the load, in place of main.tsx's black splash.

**Framing:** problem->solution

**Builds on:** C016 (meets the judges' conditions) + C021 + C003 + C015

**Problem:**

Today a tile click runs openLocalMolecule, which fetches the openMolecule chunk and then the file. LandingShell's store subscription then calls mountViewer, which does root.render(<Splash/>), erasing what the visitor touched, and awaits import('@atlas/ui/App'). Nothing carries over: not the pose, not the momentum.
C016's judges asked for:
- momentum carried across the load (playtester);
- two seams only (art director);
- prefetch on a 100 ms hold or a tap without scroll, honouring Save-Data (mobile).
Nobody designed what happens when the load takes 8 s or fails, or when WebGL can't start.

**Solution:**

1. ONE KERNEL: packages/ui/src/motion/orbitKernel.ts. Pure TS on math/time (spring.update, dampAngle, spherical). State is {az, el, vAz, vEl, roll, vRoll, up, detents, token}. The SVG hero (plain rAF), the relay stage and the viewer camera controller all use it. The camera controller is C021's replacement for OrbitControls on v9 and an R7 scheduler job after the port. Because the state layout is identical, the handoff is a copy, not a conversion. It is a turntable around the manifest 'up', matching OrbitControls' semantics.
2. BATON: {galleryId, kernelState, t, entranceSeenThisSession, source: hero|tile|finder}. It is a module singleton in the shared entry, mirrored to sessionStorage so a reload resumes the pose.
3. RELAY STAGE REPLACES THE SPLASH. When a baton exists, mountViewer creates an imperative, fixed-position DOM node outside the React root, so root.render(App) cannot erase it. The node holds the live SVG full-size on the Sage plate and keeps accepting spins. For tiles and finder rows, the static /learn/<id>.svg image morphs in first (View Transition), then swaps to a live SVG built from store.file frame 0 once it is parsed (1,200 atoms or fewer). Bigger scenes keep the static art.
4. HANDOFF. App mounts the Canvas under the stage at opacity 0. Handoff waits for the first validated frame:
- v9: two rendered frames, atoms uploaded, context not lost;
- after the port: renderer init resolved, state.webGPUSupported read, and a compileAsync prewarm of the impostor and bond variants for this atom count, run during the relay (#33821).
It then calls takeBaton(). Both surfaces render the same live kernel through a 120 ms crossfade, then the stage removes itself.
5. INTENT PREFETCH POLICY. modulepreload the App and openMolecule graphs and fetch the gallery file into the HTTP cache, all at low priority. Never add App to the landing module graph.
- Phone: prefetch on the first completed hero spin (30° or more), or a tile pointerdown held 100 ms without scroll.
- Desktop: prefetch on a 150 ms hover dwell, or finder focus plus a keystroke.
- Skip it when navigator.connection.saveData is set or effectiveType is 2g/slow-2g (Chromium only). Safari has no Network Information API, so it prefetches only on the second intent.
6. WAITING ROOM.
- After 1.2 s, a hairline ring traces the molecule while the stage stays playable.
- After 8 s, or on an import error, it shows 'Still loading the 3D view — keep playing here' with Retry, and becomes the Pocket view: spin, detents, and element cards from taps.
- On RENDER_FAILED, the Pocket view becomes the viewer, with honest copy: '3D isn't available on this device; this is a flat projection of the real coordinates.'
7. SAVE-DATA: the open link reads 'Open in 3D · ~1.2 MB'.

**Experience:**

PHONE: you spin the tiny cage and tap. It swells to full screen still spinning, and at some point you notice it has become glossy and solid. You never had to stop touching it. On a slow train it stays a playable drawing with a thin progress ring.
DESKTOP: the same with a click. On broadband the relay lasts a blink.
KEYBOARD: focus moves from the hero to the relay stage, which accepts arrow-key detent steps, and then to the canvas. The stage announces 'Loading 3D · you can keep turning it', then 'Carbon-60 open in 3D'.

**Tech:** math@0.1.0 math/time (spring.update, spring.fromResponse, dampAngle) and spherical. View Transitions with a FLIP fallback. <link rel=modulepreload> and fetch with priority 'low'. Network Information API (Chromium only). sessionStorage. After the port: renderer.compileAsync, state.webGPUSupported, a scheduler job for the camera.

**Backend:** DOM/CPU (relay); mixed (viewer handoff)

**Rides (v10 requirements):** none on v9; after the port, R7 (camera job) and R12 (renderer factory and prewarm)

**v9 slice:** Everything except the compileAsync prewarm: the kernel, baton, relay stage, prefetch policy, waiting room, Pocket view, and the handoff into the C021 kernel.

**WebGL2 fallback:** Identical. The relay is DOM, and the handoff waits for the GL2 backend's first validated frame. On old iPhones in Low Power Mode the analytic kernel keeps the same settle times at 30 Hz. With no WebGL at all, the Pocket view is the terminal state.

**Where in code:** apps/web/src/main.tsx (Splash, mountViewer, wantsViewerImmediately); packages/ui/src/LandingShell.tsx (handedOff subscription); landing/MoleculeWall.tsx; landing/MoleculeFinder.tsx:28 (openLocalMolecule); viewer/openMolecule.ts; viewer/ViewerCanvas.tsx (first-frame signal); app/CameraManager.tsx; app/ViewerScene.tsx:731 (OrbitControls); new motion/orbitKernel.ts and motion/relay.ts

**Risks:** The lifecycle of an imperative node across a React root swap. A View Transition snapshot taken while the root re-renders. Duplicate downloads if the prefetch and the real import use different URLs (use the same module specifiers). First-frame validation on v9 is heuristic. The SVG and the canvas are both live for about 120 ms.

**Honesty:** The Pocket view says it is a flat projection. The relay never shows anything but the real coordinates.

**Judges:**

- E 3/keep: Using one orbit kernel on both sides of the load is right: C003 state in both places makes the handoff a copy. The fragile parts are an imperative relay node surviving a React root swap and a View Transition snapshot taken mid-render. Both are hard to test and easy to rot. *Improve:* Hand off the baton as plain module/sessionStorage state. Leave the SVG in the DOM until the first presented frame, then crossfade. Make View Transitions an enhancement, not a dependency. Host capture-13's arrival table here.
- P 4/keep: The best answer to the dead splash: the thing you are spinning keeps spinning through the load, and the 3D camera catches it mid-spin. Momentum continuity across a load is juice most apps never get right. Risks: the imperative node across a React root swap, and SVG stutter on old phones during the relay. *Improve:* Treat it as the engine of flagship-01 rather than a separate deliverable. Playtest on a throttled 3G profile to confirm strangers keep spinning rather than waiting.
- A 4/keep: Carrying angular velocity across the load seam is the most important motion-continuity detail in the first minute. A live, thumb-spinnable relay replaces the black splash, so the screen is never dead. *Improve:* Draw the relay stage as sig-08's 'Arriving' ink plate rather than a separate visual. Add a spin-continuity assertion to fm-13.
- Pr 4/keep: Removing the black splash between the tap and the first frame is the most valuable activation fix in D1, and all of it ships on v9. The real risk is keeping the imperative relay node alive across the React root swap. *Improve:* Ship the relay stage and prefetch policy first, instrumented with viewer_ready.ms_tap_to_frame. Add the baton handoff second.
- M 4/keep: A live, playable SVG through the load, instead of a black splash, is the best thing an old iPhone on slow cellular can get. The GL2 handoff waits for a validated frame, and LPM settle times are preserved. *Improve:* Honour P-12's Data saver switch for modulepreload (iPhones send no Save-Data), announce load stages in one polite aria-live line, and cap the relay SVG at about 200 atoms.

<a id="r2-first-minute-flagship-04"></a>
## Arrival Router: one condense deformer, a 'from' field per entry point, and rules for when it plays
`R2-first-minute-flagship-04` · system · effort M · judges mean **3.6** (E4 P3 A4 Pr3 M4; keep 1, merge 4) · self-scored fun 4 / visual 5 · perf neutral

> Every way into a molecule gets the same house motion: atoms travel from a 'from' field to their true positions on one analytic spring. A small rules table picks the from field (flattened drawing, seeded gas, previous molecule, particles) and decides whether it plays at all. It is capped at 600 ms and never blocks input.

**Framing:** problem->solution

**Builds on:** C030 + C118 (rework condition) + C017 + C069 + C109 + C077 (uProgress v9 slice)

**Problem:**

C030 made condensation the house arrival, but that leaves several cases unresolved:
- A gas-cloud condense contradicts a tile that is already on screen as a drawing.
- A planar molecule seen face-on 'inflates' into nothing.
- Trajectories already use uProgress for playback.
- Returning users shouldn't wait.
- Large scenes can't afford per-atom motion.
- The product steward also condemned C118's arcs as a fake transformation.
Without rules, every entry point (tile, finder, deep link, switcher, scan, embed, replay link) will improvise its own entrance.

**Solution:**

THE DEFORMER. It is closed-form with a CPU twin:
offset_i(t) = (from_i − base_i) · (1 − S(t − d_i))
S is the analytic step response of the 'settle' token; it overshoots once after R3 and not on v9. d_i is a stagger of at most 150 ms. The whole arrival takes 600 ms or less.

FROM FIELDS:
- FLAT: each atom projected onto the centroid plane perpendicular to the view direction, i.e. the drawing.
- GAS: a seeded ball of radius 1.6R. The seed is hash(galleryId), so every visitor sees the same signature cloud for a given molecule.
- FOOTPRINT: the previous molecule's atoms reused by rank, labelled 'transition'.
- GIST: /scan or search particle positions, after the port.

RULES:
- From /, a tile or a finder row with preview art, and non-planar (flattening moves atoms by more than 0.3 Å RMS): FLAT inflate, staggered front first.
- Planar skeletons (in the shipped files, benzene lies within 0.000 Å of a plane and caffeine's heavy atoms within 0.001 Å): FLAT would be a no-op, so use GAS.
- Cold deep link, search engine or no art: GAS, staggered bottom-up.
- Replay link: none, because the replay's first frame is the arrival.
- In-viewer switch: FOOTPRINT scatter-and-condense labelled 'transition, not a reaction'. This meets C118's rework condition, proven here before any feed exists.
- Trajectories with autoplay, scenes over 50k atoms, #/mcp, embeds before their tap, export and headless agents: none. Large scenes get a 200 ms plate crossfade.
- First open per session: the full version. Later opens: a 250 ms version. Reduced motion: a still crossfade (see The Stills Minute).

INTERRUPTION: input is live from the first frame. Picking evaluates the CPU twin, so taps land on the atoms as displayed. Any key or Esc completes the arrival instantly. A touch does not cancel it, because the arrival is shorter than a flick.

v9 WITH ZERO NEW GLSL: upload the from-frame into instancePosition and instanceStart, and the true frame into instanceTargetPosition and instanceStartTarget. Sweep the existing uProgress with a critically damped spring (no stagger; uProgress is clamped 0..1 at AtomsOptimized.tsx:1576, so no overshoot), then restore both buffers to the true frame on settle. Widen the culling bounds for GAS.

AFTER R3: a per-atom hash drives d_i and the overshoot in the TSL positionNode, reading one mood-bus progress uniform. Bonds follow through R4 pairs. Evaluating the same function at t − dt gives motion vectors for free.

**Experience:**

PHONE: a tile you tap puffs up from a drawing. A friend's plain link makes the molecule condense out of its own little cloud. Switching molecules scatters one into the next, labelled 'transition'. The second molecule of the session arrives faster.
DESKTOP: the same.
KEYBOARD: any key completes the arrival, and focus lands on the canvas. SCREEN READER: 'Caffeine open in 3D'. There is no narration of the motion.

**Tech:** Existing uProgress interpolation for atoms (AtomsOptimized.tsx:342-367) and bonds (bondImpostor.ts:37-57). math/time step response mirrored as constants. math/random mulberry32 seeded from a gallery-id hash. Planarity computed offline in the preview builder. After the port: TSL positionNode, useUniforms mood bus, R4 bond pairs.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** v9: the existing uProgress hook; post-port: R3, R4

**v9 slice:** FLAT and GAS for single-frame molecules through uProgress, with no stagger and no overshoot. The rules table, session gating and interrupt handling. FOOTPRINT only where both molecules are single-frame and small.

**WebGL2 fallback:** The same closed form runs in positionNode on the GL2 backend. Scenes over 50k atoms get none. On a double penalty (GL2 plus Low Power Mode) it uses the 250 ms version.

**Where in code:** scene/src/AtomsOptimized.tsx (:342-367 vertex, :1326 and :1576 uniform and clamp), scene/src/bondImpostor.ts:56-57, scene/src/interpolation.ts, viewer/openMolecule.ts (entry-point tag), ExportManager.tsx (wait for settle), new motion/arrival.ts, tools/build-gallery-previews.mjs (planar flag)

**Risks:** The uProgress path must never collide with trajectory interpolation; the rules exclude trajectories. An export requested mid-arrival must wait for settle. GAS pushes atoms outside the fitted bounds, so culling spheres need widening. The v9 CPU twin for picking is extra code. FOOTPRINT by rank can still read as a mechanism if held too long, so cap it at 600 ms and keep the label.

**Honesty:** Argued exception: arrivals carry no 'illustrative' chip. They are UI transitions under 600 ms that end exactly on the data, like a page fade, and Learn's 'About motion' note documents them. FOOTPRINT transitions keep a 'transition, not a reaction' label because they span two molecules. Store and CPU coordinates never change; on v9 the GPU transiently holds the from-frame.

**Judges:**

- E 4/merge: Merge into R2-port-as-toy-engine-02. It is the same closed-form condense deformer. Its FROM fields (FLAT, GAS, previous molecule, particles) and its session rules are good content for Keyframe Relay. The GAS field pushes atoms outside the fitted bounds, so camera fit and sub-pixel-cull tiers need union bounds during arrival. *Improve:* Land the FROM-field table and the rules as data in port-02's twins.ts. Add an assertion that export blocks until the arrival settles.
- P 3/merge: A sound rules table (first open only, cancel on touch, 600 ms or less), but it is the third spec of the same condense motion, after port-02 and sig-07. The arrival is a 600 ms beat, not a toy. Host: R2-port-as-toy-engine-02. *Improve:* Keep the from-field table and session rules as a section of Keyframe Relay. Prioritise the previous-molecule scatter on switch, because strangers see it on every switch, not just the first open.
- A 4/merge: Host: R2-signature-and-moonshots-07. The idea is right: one deformer, a 'from' field per entry point, and rules for when it plays. FLAT (condensing from the drawing plane) is the elegant tile arrival. But it forks the Condense spec: a 1.6R gas cloud and a ≤150 ms bottom-up stagger here, against sig-07's 2.2× ellipsoid and ≤120 ms centre-out stagger. *Improve:* Fold its rules table into sig-07's reuse map. FLAT for tile entries, GAS for entries with no image. One set of constants, signed by the art director.
- Pr 3/merge: Merge into R2-port-as-toy-engine-02. The useful part is the rules table: which entry points get an arrival and when it is skipped. The deformer itself is the third copy of condense, after Keyframe Relay and Signature Condense. *Improve:* Move the from-field rules table and session gating into Keyframe Relay.
- M 4/keep: The rules table decides when not to play: none above 50k atoms, a reduced path on the GL2+LPM double penalty, first open per session, and at most 600 ms. That is a designed degrade, not an afterthought. *Improve:* Make the reduced-motion output an explicit 150 ms crossfade (not a skip), take PE-10's Standard/Gentle/Still setting as a router input, and never animate while a screen reader has focus in the scene.

<a id="r2-first-minute-flagship-05"></a>
## Detents That Mean Something: flicks land on the molecule's own symmetric views
`R2-first-minute-flagship-05` · science-toy · effort M · judges mean **4.4** (E4 P4 A5 Pr4 M5; champion 1, keep 2, merge 2) · self-scored fun 4 / visual 4 · perf neutral

> Instead of arbitrary 'hero angles', each molecule's coast settles into views computed from its own coordinates: C60's 12 pentagon and 20 hexagon face-on axes, or a flat ring's face-on and edge-on views. Every flick ends on a composed picture with a one-line observation.

**Framing:** problem->solution

**Builds on:** C021 (detents made concrete) + C090 (pose as puzzle) + C076 (symmetry as play) + the curated student prompts

**Problem:** C021's detents were unspecified 'art-directed hero angles'. Nobody decided which angles, how many, how to find them for 70+ molecules, or how a snap should feel on a turntable. Arbitrary detents feel like a UI grid, and no detents at all leave rests at ugly angles. Meanwhile the curated observation prompts ('Look for different polygon shapes', 'View the ring from above, then from the side') aren't tied to any gesture.

**Solution:**

OFFLINE, in the preview builder: ring perception on the distance-inferred bond graph, plus principal axes of inertia and planarity. Checked on the shipped C60, this finds 12 five-rings and 20 six-rings. Adjacent 5-fold and 3-fold axes are 37.3° apart, and no direction is more than 22.7° from one of them.
DETENT TYPES:
- RING_FACE: n-ring centroid directions.
- PLANE_FACE and PLANE_EDGE: planar or near-planar skeletons.
- PRINCIPAL: 3 axes, both signs, for everything else.
- AUTHORED: from the curated prompts.
They are stored in the hero-pose manifest together with an adjacency graph.
KERNEL BEHAVIOUR: detents are magnets, not rails.
- When coast speed drops below a threshold, the kernel retargets to the nearest detent inside a forward cone, within the capture radius: 24° for C60, so every rest clicks, and 12° by default.
- It uses the 'click' token: slightly underdamped, with one visible overshoot.
- Outside capture, it simply rests.
- A coast never reverses to reach a detent.
- On /, the hero turns only about 'up', so its detents are azimuths only.
AT REST:
- A small label shows for 1.2 s, generated from measured geometry: 'Pentagon face-on · 5-fold axis', or 'Edge-on: 14 heavy atoms in one plane (±0.001 Å in this file)'. It is also sent to aria-live.
- The glyph flashes and a C041 tick plays.
- The 5-fold label appears only if a rotation test on the file passes within tolerance; otherwise it reads 'Ring face-on'.
KEYBOARD: ←/→/↑/↓ hop to the adjacent detent in that screen direction, and Home returns to the hero pose. A screen reader hears 'Hexagon face-on, view 3 of 32'.
OPTIONAL QUIET MASTERY (for D7): 'pentagons seen 5/12' on C60, stored locally only.

**Experience:**

PHONE: flick the buckyball and it always lands with a pentagon or hexagon dead centre, with a tick. On caffeine, one flick lands edge-on and the ring vanishes into a line.
DESKTOP: two-finger swipes coast into the same views; arrow keys hop around the cage like a globe of views.
SCREEN READER: each rest is spoken, so turning becomes a tour of named views.

**Tech:** Offline ring perception and inertia tensor in tools/*.mjs (math/shapes quickhull3 is optional for hull faces on crystals). Runtime: math spherical, spring.update, dampAngle; nearest detent by dot product over 32 or fewer unit vectors.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for demand frames after the port)

**v9 slice:** All of it: offline detection, manifest, kernel magnets, labels, keyboard and screen-reader support.

**WebGL2 fallback:** Camera-only, so identical on every backend.

**Where in code:** tools/build-gallery-previews.mjs and tools/build-student-previews.mjs (perception), packages/ui/src/gallery/previews.json (manifest), new motion/detents.ts in motion/orbitKernel.ts, app/ViewerScene.tsx, landing PocketHero, gallery/studentCollection.ts (prompts to AUTHORED detents)

**Risks:** Ring perception on inferred bonds can mislabel strained or metallic structures, so limit it to curated and quick-pick sets. Too-dense detents feel sticky. Turntable poles are awkward. Labels must not overclaim symmetry that is only approximate in a file.

**Honesty:** Labels are computed from the shipped coordinates with a stated tolerance and phrased as observations about 'this structure file'. They fall back to plain 'Ring face-on' when the symmetry test fails.

**Judges:**

- E 4/merge: Merge into R2-joy-and-mastery-04. The ring-face and plane detents are verified geometry and camera-only, so they behave identically on every backend. Its PRINCIPAL and PLANE_EDGE fallbacks for non-symmetric molecules fill the gap in joy-04's pure point-group approach. *Improve:* Compute everything once in Object Facts (joy-01). Keep ring perception to curated and quick-pick files, where inferred bonds are trustworthy.
- P 4/merge: Detents computed from the molecule's own rings and planes make every flick end on a meaningful picture; the click at the end of a spin is the core fidget satisfaction. Its detent types for low-symmetry molecules (principal axes, plane-edge, authored) are exactly what joy-04 lacks. Host: R2-joy-and-mastery-04. *Improve:* Merge it in as the fallback detent set for asymmetric molecules, and keep capture soft outside Play so free inspection never feels sticky.
- A 5/champion: Every coast ends on a composed picture computed from the molecule's own coordinates. That makes composition a system, so any screenshot is well framed by default. Unlike joy-04, it covers every molecule through the principal-axes fallback. *Improve:* Absorb joy-04's mandala lock (FOV narrows at a true axis, roll set upright) and cross-05's seam meter. Tune the capture cones so free inspection never feels sticky, and set detent labels in sig-05's Etched Type.
- Pr 4/keep: This fits the contract best of all the feel ideas. Detents computed from the file answer the curated prompts ('look for different polygon shapes'), so every flick ends on a view worth inspecting: fun that serves inspect and learn. It is camera-only, ships on v9 and behaves the same on every backend. It hosts Symmetry Detents and Kaleidoscope. *Improve:* Take Symmetry Detents' chords and chains as an opt-in layer. Limit ring perception to the curated set and state the tolerance in Learn.
- M 5/keep: Camera-only, identical on every backend and shippable on v9. Meaningful detents make arrow-key stepping and screen-reader announcements ('Face-on: the fused rings') real content, and give reduced motion a designed still per step. Host for JM-04. *Improve:* Absorb JM-04's symmetry axes. Keep capture soft for users with tremor (no sticky wells), turn detents off during measurement, and always announce the detent in words, never only as a sound.

<a id="r2-first-minute-flagship-06"></a>
## Poke Torque: one tap grammar that feels physical on v9 and rings for real after R3
`R2-first-minute-flagship-06` · toy · effort S · judges mean **3.4** (E4 P4 A3 Pr3 M3; keep 5) · self-scored fun 4 / visual 3 · perf neutral

> A tap on an atom at rest pushes the whole molecule like a flicked globe: it turns away from your finger and boings back to its detent. On v9 that comes with a DOM ripple ring, an element card and a mode-arrow overlay. After R3 the same tap event drives the baked pluck or the crisp ripple, and the grammar doesn't change.

**Framing:** problem->solution

**Builds on:** C028 + C073 + C021 + C009 + C093 (mass-pitched plink)

**Problem:** 'Tap = Pluck' (C028 plus C073) is the round's best verb, but it needs R3/R4, which are 4 to 5 months away. Until then a tap in the viewer selects silently, so the first minute has no answer to its most natural second gesture. Even after R3, nothing says what a tap means on a coasting molecule, during the arrival, or on empty space.

**Solution:**

TAP ROUTER: one pointer-up handler, triggered by 8 px or less of travel within 300 ms. It yields to armed measurement tools and to open panels.
(1) Molecule coasting: CATCH. Velocity goes to zero with a 1° settle-back on the 'snap' token, plus a tick.
(2) At rest, on an atom: POKE.
(3) At rest, on empty space: nothing. It is reserved, so no zoom and no burst in the first minute.
(4) During the arrival: POKE, tested against the CPU-twin positions.

POKE ON v9 (camera plus DOM, zero GLSL):
- An angular impulse Δω = k·(r × n̂), where r is the tapped atom's view-space offset from the centroid and n̂ points into the screen. It is added to the orbit kernel's velocity, capped at 6°, and returns to the detent on the 'boing' token (ζ ≈ 0.5, about 600 ms).
- A lime DOM ring expands from the projected tap point over 300 ms.
- A card reads 'C · carbon · atom 17 of 60', from existing AtomInfoHUD data.
- A plink pitched by 1/√mass plays if sound is on.
- On molecules with baked modes, a DOM overlay of per-atom displacement arrows shows the most-excited mode for 1.5 s while its chord plays: v9's honest preview of the pluck ('how it would move').

POKE AFTER R3:
- The torque drops to 2°, a whole-body flinch, and the atoms do the talking.
- On baked molecules, each mode k is excited by the tap impulse's projection onto it (a_k ∝ e_k[i]·n̂, mass-weighted), with the ×N chip.
- Elsewhere, C028's crisp 400 ms ripple plays from the touch-field slots.
- Bonds follow via R4 pairs, and hits use C009's finger-sized 9×9 ID patch.
One event, the same callbacks, and a richer response once the port lands.

**Experience:**

PHONE: tap the edge of the buckyball and it spins away a few degrees and bounces back into place with a ring under your finger. It feels like a real object months before the port. Tap it while it's spinning and it stops dead.
DESKTOP: click for the same response.
KEYBOARD: Space pokes the focused or hovered atom (D2's atom cursor), and Enter catches a coasting molecule.
SCREEN READER: 'Carbon, atom 17 of 60, bonded to 3'. When the arrows show, 'Breathing mode: every atom moves outward and inward together.'

**Tech:** math/time spring.update ('boing' token), vec3 cross into scratch tuples. The existing CPU AtomPicker and SpatialAnchor selection (fine for a tap; not for hover). A DOM SVG overlay projected with camera matrices. After the port: a half-float mode buffer via useBuffers into the TSL positionNode, useUniforms touch-field slots, and the ID MRT with readRenderTargetPixelsAsync.

**Backend:** DOM/CPU on v9; [GPU+GL2] after R3

**Rides (v10 requirements):** v9: none; post-port: R3, R4, R2 (flag byte for the tapped-atom highlight)

**v9 slice:** The whole router, the torque, ring, card, mode-arrow overlay and chord.

**WebGL2 fallback:** After the port, the mode and ripple deformers are closed-form in positionNode on the GL2 backend, and RGBA8 ID picking works on both backends.

**Where in code:** app/ViewerScene.tsx (SpatialAnchor onPick at ~:690-719), AtomInfoHUD.tsx, SelectionMarkers.tsx, lib/clickSound.ts, new motion/tapRouter.ts and motion/orbitKernel.ts; after the port, the TSL atom and bond ports of scene/src/AtomsOptimized.tsx and bondImpostor.ts

**Risks:** Tap-versus-select semantics: existing selection and measurement must win when armed. A camera nudge could read as a glitch if too large, so cap it. Arrows could be misread as forces; label them as mode shapes. The v9 CPU picker allocates per step, so use it on tap only.

**Honesty:** On v9, atoms never move; the flinch is the camera. Arrows are labelled 'mode shape · computed (method, version) · display only'. After R3 the ×N amplitude chip shows, and the ripple on unbaked molecules is labelled illustrative.

**Judges:**

- E 4/keep: Small, zero-GLSL on v9, and it gives tap a physical answer months before R3. After the port, the same router feeds pluck and ripple slots. The CPU AtomPicker is acceptable on tap-up, not on hover. A camera nudge is camera motion and must obey the comfort caps. *Improve:* Implement it as an intent in the play-01 arbiter, cap the angular impulse under play-10's comfort budget, and after R3 route it to a Touch Field slot (port-03).
- P 4/keep: It fixes 'tap does nothing' on v9, and a tap is the second gesture every stranger tries. A globe-like push that boings back reads instantly, and the element card is a bonus. Risks: the camera nudge can read as a glitch, and the mode arrows can read as forces. *Improve:* Make the torque proportional to the tap's offset from the centre so it feels physical, and put a sound on the boing. Where modes are baked, replace the arrows with Mode Harp's real v9 mode playback.
- A 3/keep: A useful v9 bridge, but one tap gets four simultaneous responses: a camera nudge, a DOM ripple ring, an element card and a mode-arrow overlay. That is busy, and arrows over atoms read as forces. *Improve:* Pick two responses: the torque and a single ink ring. Show mode arrows only on a second tap or under reduced motion. Retire the whole thing when R3 lands.
- Pr 3/keep: It gives v9 a tap response months before R3, so the first poke isn't dead. But a tap on an atom already means select or measure, and nudging the whole molecule on tap could read as a glitch. *Improve:* Put it under the Gesture Constitution's tap law. A/B it against a plain select plus element card.
- M 3/keep: A zero-GLSL v9 tap response with an element card and keyboard Enter. The camera nudge is input-caused, but 'turns away from your finger' is unexpected motion for vestibular users. *Improve:* Cap torque at a few degrees, set it to zero under Gentle/Still, and give Enter on the atom cursor the same card plus a still ring pulse.

<a id="r2-first-minute-flagship-07"></a>
## Verb Ladder: one new verb per beat, taught by an abstract touch mark only when you hesitate
`R2-first-minute-flagship-07` · system · effort S · judges mean **3.2** (E3 P4 A3 Pr3 M3; keep 1, merge 4) · self-scored fun 3 / visual 3 · perf neutral

> The first minute unlocks verbs in order: spin, open, flick, catch, pluck, hear, replay, share. A lime touch mark (a ring with a short trail, never a hand, never moving the molecule) demonstrates only the next verb, only after 4 s of hesitation, and at most three times a session.

**Framing:** problem->solution

**Builds on:** C019 (reworked as an abstract mark) + C020 (invitation instead of sway) + D2 discoverability gap

**Problem:** C019's ghost hand was judged a mobile-game cliché (art director) and unrequested camera motion (mobile judge). ViewerGestureHint lists three verbs at once and vanishes on the first canvas pointerdown, so strangers learn only 'drag'. Round 1 flagged toy discoverability as a gap: nothing tells a stranger that a tap plucks or that sound exists. Fixed-time tutorials annoy people who already know the verb.

**Solution:**

THE LADDER. Kept per device in localStorage as a bitmask, with no PII.
0 spin (the static glyph on /) → 1 open → 2 flick → 3 catch → 4 poke/pluck → 5 hear → 6 replay → 7 share.
A rung counts as done when the verb is performed, however it was learned.
TRIGGER. The next undone rung's hint appears only if all of these hold:
- the molecule has rested 4 s or more after a settle;
- no hint has shown in the last 12 s;
- fewer than 3 hints have shown this session;
- the route is not #/mcp, an embed or an agent;
- no panel is open.
THE MARK.
- A DOM SVG in the brand lime (#d5ef9c): a 28 px ring with a 6-sample fading trail.
- Each frame it is positioned by projecting its 3D target, so it follows the atom as you spin.
- It moves on the shared motion tokens, using math/time easing (0.1.0 has no back or elastic easing, so overshoot comes from springs).
PERFORMANCES. Only the mark moves, never the molecule.
- FLICK: the ring sweeps 80 px and lifts off.
- CATCH: shown only while the molecule is coasting; the ring pulses over it.
- POKE: the ring lands on the front-most atom and contracts twice.
- HEAR: the ring circles the ♪ chip.
- REPLAY: the ring circles the Replay chip.
Every performance has a caption twin (for example 'Tap an atom'), also sent to aria-live.
DESKTOP FORM: the ring gains a small pointer glyph, and the caption names the key ('click · or press Space').
ACCESSIBILITY:
- Reduced motion: a still ring with an arrow glyph.
- forced-colors: a CanvasText outline.
- prefers-reduced-transparency: a solid ring.
SCOPE. On the flagship path it replaces the text pill; the pill stays on other routes. It consumes D2's gesture map, so rungs never teach a contested verb.
TESTING. The mark exposes data-target coordinates, which the contract test uses to climb the ladder: C019's CI-smoke idea, made concrete.

**Experience:**

PHONE: after you've spun it a while and stopped, a small lime ring settles on an atom and presses twice. You tap there and it rings. You never see a hand or a paragraph, and if you'd already tapped you never see the mark at all.
DESKTOP: the same, with the Space hint.
KEYBOARD and SCREEN READER: the caption is the hint, spoken once politely, and it names the key.

**Tech:** DOM SVG. math/time easing (cubicInOut, expoOut) and spring.update. Projection with math mat4/vec3 into scratch tuples. localStorage (wrapped in try/catch, as ViewerGestureHint already does with sessionStorage). aria-live.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it.

**WebGL2 fallback:** DOM, so identical.

**Where in code:** app/ViewerGestureHint.tsx (replace the pill on the flagship path), ViewerApp.tsx:755, new motion/verbLadder.ts and components/TouchMark.tsx, landing PocketHero (rung 0 glyph)

**Risks:** Hint fatigue. The mark may obscure the atom it points at. The 4 s threshold is a guess that telemetry must tune. The ladder is only as good as D2's conflict-free grammar.

**Honesty:** Hints teach gestures only and make no science claims. The mark never moves atoms or the camera.

**Judges:**

- E 3/merge: Merge into R2-play-for-everyone-12. The hint policy (4 s of rest, 12 s spacing, at most 3 hints per session) is sensible DOM logic, but it duplicates that idea's hint ladder and the touch-mark layer. The 4 s threshold is untested. *Improve:* Make it the trigger policy of play-12's 'Show me' ladder, rendered through play-14's touch marks.
- P 4/keep: Teaching on hesitation (after 4 s, at most 3 times a session, with an abstract mark) is how good games onboard, with no text pill and no nagging. The ladder gives discovery an order. Risks: the thresholds are guesses, and real strangers won't progress linearly. *Improve:* Tune the thresholds in Couch Test and let rungs complete out of order silently. Share one visual language with Touch Marks.
- A 3/merge: Host: R2-play-for-everyone-14. An abstract ring with a short trail that never moves the molecule meets the round-1 art-director condition, but it duplicates play-14's mark layer and play-12's hint ladder. *Improve:* One mark layer (play-14), with this ladder as its first-minute script. Take the lime from sig-01's tokens.
- Pr 3/merge: Merge into R2-play-for-everyone-14. Hints that appear only after hesitation, at most 3 a session, are the right discipline. But this is a third hint system, alongside Touch Marks' 'Show me' and the Notebook's hint ladder. *Improve:* Make it the first-minute script inside Touch Marks.
- M 3/merge: Merge into PE-12. The humane hint throttle (4 s of rest, at most 3 per session, never on #/mcp) duplicates PE-12's hint ladder and PE-14's 'Show me'. *Improve:* Fold the throttle rules into PE-12. Persist dismissal, announce hints politely, and never draw the mark over the target atom.

<a id="r2-first-minute-flagship-08"></a>
## Cue Sheet on the Beat: sounds scheduled from spring maths, with audio unlocked by a toy, not a setting
`R2-first-minute-flagship-08` · system · effort S · judges mean **3.8** (E4 P4 A4 Pr3 M4; merge 5) · self-scored fun 4 / visual 2 · perf neutral

> Every first-minute cue (a tick at each detent, a whoosh that follows flick speed, a thud on catch, C60's chord on pluck) is scheduled at the analytic time the spring says it happens. Audio switches on only when the stranger taps a '♪ Hear it' chip that appears after their first pluck.

**Framing:** capability->problem

**Builds on:** C041 (fires on the springs' own events, as the art director asked) + C073 (octave fix) + C093 + C021

**Problem:**

C041 is a vocabulary without a score: it doesn't say when each sound fires, how it syncs to motion, what the default is, or how iOS limits shape it.
- Lupi's clickSound is 'opt-in and OFF by default — a scientific tool shouldn't make noise', and it has no toggle UI.
- Since iOS 26.5, web haptics reportedly fire only from direct taps on DOM switches (library-author claim, unverified).
- Safari's Web Audio runs in the ambient session, which obeys the silent switch.
- C073's 37-octave transposition puts C60's breathing mode at about 108 Hz, below what phone speakers reproduce.
- Cues fired from rAF land up to a frame late at 30 Hz in Low Power Mode.

**Solution:**

CAPABILITY: the kernel's springs and the deformers' decays are closed-form, so the time of every settle, detent crossing and catch is known before it happens.

SCHEDULING. The kernel emits events with predicted times, and each cue is scheduled at AudioContext.currentTime + Δ rather than on the next rAF. Sound lands on the motion beat at any display rate.

DEFAULT: SILENT. After the first poke or pluck of the session, a '♪ Hear it' chip rises in the thumb zone for 6 s. Tapping it is a direct DOM tap, which:
- resumes the shared AudioContext inside the gesture;
- legitimately fires the iOS switch haptic, and vibrates 12 ms on Android;
- replays that pluck with sound.
The opt-in persists per device through the existing clickSound storage, with a visible mute chip.
We do not set navigator.audioSession.type = 'playback'. That API is Safari-only, and leaving it alone means the silent switch keeps its meaning; captions cover the muted case.

CUES.
- tick: on each detent; 5-fold pitched higher than 3-fold; 6 ms vibrate on Android.
- whoosh: filtered noise with gain proportional to angular speed above 1 rad/s, ducked under chords.
- thud: on catch.
- boing: when the poke torque returns.
- chord: on pluck. The baked mode wavenumbers × c ÷ 2^36 give about 216 Hz and 641 Hz for C60's textbook ~496 and ~1469 cm⁻¹ lines, audible on phone speakers. The envelope uses the same decay constant as the visual ringing.
- settle chime: when the arrival settles, and only if audio is already on.
- sent: when a share succeeds.
No sound ever plays on /. There is an 8-voice cap, and ticks are rate-limited to 20 per second.

CAPTIONS. The first three cues of each kind show a caption chip ('♪ breathing mode · ≈216 Hz · 36 octaves down'). Every cue has a visual twin (glyph flash, ring pulse), so a muted phone loses nothing essential.

**Experience:**

PHONE: you pluck the cage and a small chip says 'Hear it'. You tap, and the cage rings with a low hum and a bright partial an octave and a fifth above. From then on detents tick like a watch, and fast flicks whoosh.
DESKTOP: the same, and H toggles sound.
SCREEN READER: cue captions are spoken politely the first time, and the chord works as an audio-first channel.

**Tech:** Web Audio: one AudioContext, oscillators plus a noise buffer, optional ZzFX (under 1 KB); scheduled with AudioContext.currentTime. navigator.vibrate on Android. An iOS switch-haptic overlay (@haptics/vanilla or ios-haptics; the 26.5 behaviour is from https://haptics-web.vercel.app/ and is unverified). AudioSession is Safari-only (https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type) and deliberately left at its default. Events from the orbit kernel and deformer controllers.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (scheduler-phase events after R7)

**v9 slice:** All of it. On v9 the chord plays alongside the poke-torque mode-arrow overlay.

**WebGL2 fallback:** DOM audio, so identical. On the Low Power Mode 30 Hz cadence, sample-accurate scheduling keeps cues on the beat.

**Where in code:** lib/clickSound.ts (the existing AudioContext resume pattern at :49-60, and the opt-in storage), new motion/cues.ts, motion/orbitKernel.ts (event API), app/ViewerScene.tsx, the C073 modes manifest

**Risks:** iOS haptics are unverified. Sound can annoy, so keep it quiet and capped. A fixed 36-octave transposition can't adapt to speakers versus headphones, so state it in the caption. Baked xtb frequencies will differ from the textbook values, and captions must show whichever value is baked.

**Honesty:** Captions name the method and version of the baked modes and the octave transposition. Pitches come from the manifest, not hand tuning. Only the amplitude of the visual exaggeration is flagged ×N.

**Judges:**

- E 4/merge: Merge into R2-joy-and-mastery-09. Its key engineering point is correct and valuable: the springs are closed-form, so cues can be scheduled at AudioContext.currentTime plus the analytic Δ. Sound then lands on the beat even at Low Power Mode's 30 Hz. The opt-in '♪ Hear it' chip resolves the audio-default argument cleanly. *Improve:* Make predicted-time scheduling the Sound Kit's core rule, and emit predicted settle and detent times from the C003 kernel.
- P 4/merge: Scheduling cues at the spring's analytic event time is the right juice trick: sound lands on the beat at any frame rate. A '♪ Hear it' chip after the first pluck unlocks audio at peak curiosity. Host: R2-joy-and-mastery-09. *Improve:* Merge it in as the Sound Kit's scheduler and unlock policy. Make the chip a haptic DOM tap, and test whether a chip appearing mid-play gets noticed on phones.
- A 4/merge: Host: R2-joy-and-mastery-09. Scheduling each cue at the spring's analytic event time is the correct fix for motion-sound sync, better than firing on the next rAF. It is exactly what the round-1 art director asked for. *Improve:* Fold it into joy-09 as that engine's scheduler. Audio stays off until the '♪ Hear it' tap.
- Pr 3/merge: Merge into R2-joy-and-mastery-09. It settles round 1's audio-default argument well: silent until a toy offers a '♪ Hear it' tap. Scheduling cues from spring maths is clever. But this is a policy of the sound engine, not a product of its own. *Improve:* Adopt 'silent by default, unlocked by a toy' as the Sound Kit's rule.
- M 4/merge: Merge into JM-09. Silent by default until an explicit '♪ Hear it' DOM tap is the right audio policy. Audio-clock scheduling keeps cues on the beat at the 30 Hz LPM cadence, and the captions are stated. *Improve:* Make this the Sound Kit's default policy. Note that the iOS ringer switch mutes Web Audio unless navigator.audioSession is set, so captions must carry the meaning. Never convey anything by haptics alone.

<a id="r2-first-minute-flagship-09"></a>
## Instant Replay: the last six seconds, re-performed frame-exact from an input log and sent in two taps
`R2-first-minute-flagship-09` · share-loop · effort M · judges mean **3.6** (E4 P4 A3 Pr4 M3; merge 5) · self-scored fun 5 / visual 4 · perf costs

> The viewer keeps a 10-second log of inputs and kernel keyframes. When a 'moment' happens, a Replay chip offers the best 6-second window. It re-performs through the same analytic kernel into a fixed-size 9:16 target and encodes while you watch the preview, then goes to the share sheet with a replay link.

**Framing:** capability->problem

**Builds on:** C103 + C112 (phase 1 only) + C106 (end card) + C027 + the playtester's Instant Replay spark

**Problem:** C103's templated loops are scripted, not 'what I just did' (the playtester's spark). Screen recording drops frames and captures UI. The existing export is a real-time 5 s MediaRecorder at 1920×1080 (FigureExportPanel.tsx:57-60). VideoFrame from a WebGPU canvas on Safari is unverified. navigator.share needs a fresh user activation, so a Share button pressed while an encode is still running can fail.

**Solution:**

CAPABILITY: the camera kernel and, after R3, every deformer are closed-form, so a performance can be stored as its inputs and re-performed exactly at any frame rate.

LOG. A ring buffer holds:
- pointer samples, resampled to 60 Hz and quantized to 1/256 rad (which also strips micro-tremor);
- release velocities;
- taps with atom index and impulse;
- keys and sound state;
- a full kernel and deformer keyframe every 0.5 s, as drift anchors against future token tweaks.
The format is versioned r1, with a motion-token table version. After delta coding and CompressionStream('deflate-raw'), 6 s is about 1 KB.

MOMENT DETECTOR (local only). A moment is a flick over 1 rev/s that ends on a detent, 3 or more plucks within 4 s, or a catch within 150 ms of a detent crossing. It raises '↺ Replay' at bottom right for 8 s, at most twice a session.

WINDOW. Choose the 6 s that maximise angular energy plus events, starting on a keyframe. Trim toward rest at both ends so it loops cleanly.

RE-PERFORMANCE.
- v9: set frameloop 'never' and advance() a replay camera through the kernel at a fixed 1/30 s into a fixed-size WebGLRenderTarget (720×1280, or 1080×1080 on desktop). Arrivals replay via uProgress. DOM overlays (ring, arrows, card) are redrawn with Canvas2D onto each readback.
- After the port: R9 fixed-size output on both backends, with deformer events replayed closed-form (C027's contract makes this exact).
- Readback uses readRenderTargetPixelsAsync into VideoFrames, encoded by Mediabunny to WebCodecs H.264 MP4. MediaRecorder is the last resort. Never build a VideoFrame from a WebGPU canvas on Safari.
- The encoder runs through ExportManager's named phases, never numeric priorities (the R7 trap).

SHEET.
- The preview plays instantly: the same log re-performed live in a letterboxed view.
- Send shows a progress ring and enables only once the File exists, so navigator.share({files}) runs synchronously inside the tap.
- Buttons: Send, Copy link (see Your Turn) and Save. Desktop gets a 1:1/9:16 toggle, with Copy link as the primary action.

DESIGN.
- An Illustrate-style 0.8 s end card: name, formula, 'real coordinates · motion illustrative', and the lupi URL.
- A corner 'illustrative' mark throughout.
- Cue captions are burned in.
- Alt text and the share caption are generated from name, formula and verbs ('Carbon-60, spun and plucked in Lupi').

**Experience:**

PHONE: you nail a fast flick that clicks onto a pentagon, and a Replay chip appears. One tap shows your six seconds looping; a second tap sends the MP4 and link.
DESKTOP: pick 1:1, copy the link, and download the MP4 if you want it.
KEYBOARD: R opens Replay, and Tab reaches Send, Copy and Save. The Send button's disabled state announces 'Preparing video, 60%'.
SCREEN READER: the sheet reads the generated alt text.

**Tech:** R3F 9 advance() with frameloop 'never'. WebGLRenderTarget plus readRenderTargetPixelsAsync. Mediabunny with WebCodecs VideoEncoder (mp4-muxer is superseded; https://vanilagy.github.io/mp4-muxer/). MediaRecorder fallback. CompressionStream('deflate-raw'). Web Share Level 2 files (https://web.dev/articles/web-share). After the port: R9 fixed-size output, useRenderTarget, scheduler manual stepping.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** post-port: R7, R9, R3 (deformer replay); v9 slice: none

**v9 slice:** Replays of camera, detents, arrival and DOM overlays, encoded to MP4 with Mediabunny from WebGL readbacks, plus the sheet and alt text.

**WebGL2 fallback:** readRenderTargetPixelsAsync works on the GL2 backend, and the encode path is the same. Without VideoEncoder, the sheet offers the four-frame contact sheet PNG (from The Stills Minute) plus the link.

**Where in code:** ExportManager.tsx (phases at :455-521), FigureExportPanel.tsx:57-60, viewer/captureViewerThumbnail.ts, SavedViewButton.tsx:251-294 (share paths), new share/replayLog.ts, share/momentDetector.ts and share/replayEncoder.ts, analytics/events.ts

**Risks:** Kernel changes break old logs; version tags and keyframes contain the damage. Encode time on old phones is unknown, so Send may wait. iOS reportedly sometimes shares MP4s as text (unverified). Stream-encode rather than buffering 180 frames. Gesture logs are behavioural data, so they are quantized, stay local until shared, and never go to analytics.

**Honesty:** A corner 'illustrative' mark runs throughout, and the end card reads 'real coordinates · motion illustrative'. Replays are never MCP or V1/V2 artifacts.

**Judges:**

- E 4/merge: Merge into R2-capture-share-loops-03. It is the third of four Instant Replay pitches. Encoding from readRenderTargetPixelsAsync buffers rather than VideoFrame from a WebGPU canvas is the right Safari hedge. Encode time on old phones is unmeasured. *Improve:* Use port-12's tape format, and encode through capture-01 only when Send is tapped.
- P 4/merge: The same Instant Replay as capture-03 and port-12. The best-6-second-window picker and the 9:16 encode are good details. Host: R2-capture-share-loops-03. *Improve:* Keep its moment detector (a flip caught, a chain landed, a lucky roll) as what surfaces the Replay chip.
- A 3/merge: Host: R2-capture-share-loops-03. It duplicates cap-03 and port-12. Its useful parts are the frame-exact 9:16 re-render (which allows proper framing) and the 'moment' detector. *Improve:* Merge. Keep the moment detector and the four-frame contact-sheet fallback.
- Pr 4/merge: Merge into R2-capture-share-loops-03. It is the same capability as capture-03 and the Replay Tape. Only the 'moment detection' offer chip is new. *Improve:* Contribute the moment-chip heuristic to capture-03.
- M 3/merge: Merge into CS-03. It is the same Instant Replay; encode time on old phones is unknown ('perf costs'), and it states no reduced-motion path. *Improve:* Adopt CS-03's storyboard-of-stills path under reduced motion. Encode in a worker only after the sheet opens, and offer a four-frame stills share when VideoEncoder is missing.

<a id="r2-first-minute-flagship-10"></a>
## Your Turn: a replay link performs the sender's six seconds live in the recipient's viewer, then hands them the molecule
`R2-first-minute-flagship-10` · share-loop · effort M · judges mean **3.4** (E4 P4 A3 Pr4 M2; rework 1, merge 4) · self-scored fun 5 / visual 3 · perf improves

> The replay log fits in the URL fragment, so a shared link needs no storage and no video. The recipient's viewer re-performs the sender's spin and pluck on their own device, and any touch takes the baton. Their first minute starts mid-play and ends with 'Reply'.

**Framing:** capability->problem

**Builds on:** C103 + C062 (codes in links) + C106 (unfurl card at the start pose) + C107 (lineage-lite as a counter) + C109

**Problem:** A video share is a dead end: the recipient watches and leaves. It also costs encode time, and hosting clips needs storage with no cost owner. Saved views need sign-in and carry only a pose. Nobody designed the recipient's first minute: arriving cold at a deep link, they get the generic arrival and the text pill, with no trace of what their friend did.

**Solution:**

CAPABILITY: an input log of about 1 KB replays exactly through the analytic kernel (see Instant Replay).

LINK SHAPE: /?sim=<galleryId>&p=<az>,<el>#r=<base64url deflate log>.
- The fragment never reaches the server, and analytics never see it, because track() already strips query and hash.
- p= carries only the start pose. It lets the edge Satori card (C106) render the molecule at the replay's first frame for unfurls.
- The parser is strict: 2 KB or less, 12 s or less, clamped numbers and enums, no strings, version r1.
- r1 links carry curated gallery ids only; no PubChem names or uploads go into URLs.

THE RECIPIENT'S ARC.
- 0 s: the link mounts the viewer directly (wantsViewerImmediately), and the Arrival Router picks 'none'.
- 0.5 s: the molecule appears at the sender's start pose with a pill: 'Replay · from a friend · illustrative'.
- 0.5 to 6.5 s: the kernel re-performs the log live. Ticks and the chord play if the recipient's sound is already on; otherwise captions show.
- Any time: the recipient's first touch takes the baton. The replay stops, and its current kernel state becomes theirs, the same handoff as the Relay Baton.
- 6.5 s: the touch mark says 'Your turn' on the front atom.
- After their first moment, the Replay chip reads 'Reply' and mints their own link with &re=1. That is a hop counter only, with no identity, so a chain can be measured without accounts.

FALLBACK: an unknown version or a failed parse falls back to a normal cold arrival, plus a toast: 'This replay was made with a newer Lupi.'

**Experience:**

PHONE: a friend's link opens and the buckyball is already spinning the way they spun it. It pops onto a pentagon and rings, then you touch it and it's yours. Reply sends yours back.
DESKTOP: the link pasted in Slack shows the card at the same angle, and clicking it replays.
KEYBOARD: Space or any arrow key takes the baton. A Replay button restarts it.
SCREEN READER: 'Replay from a friend: spin, pentagon face-on, pluck. Your turn.' The log's verbs are summarised as text.

**Tech:** CompressionStream and DecompressionStream ('deflate-raw'), base64url, the URL fragment. A Worker Satori card rendered from gallery coordinates at p= (C106 path). The orbit kernel and baton handoff. The existing wantsViewerImmediately routing.

**Backend:** DOM/CPU (plus the viewer)

**Rides (v10 requirements):** none for camera and detent replays; R3/R4 for deformer events after the port

**v9 slice:** Replays of camera, detents, poke torque and cues, the recipient's arc, Reply links and the p= unfurl card.

**WebGL2 fallback:** Identical, because a replay is kernel state rendered by whichever backend is present. A v9 build ignores deformer events it doesn't know and says so in the pill.

**Where in code:** apps/web/src/main.tsx (wantsViewerImmediately), viewer/viewerRoutes.ts, new share/replayLog.ts, apps/mcp-worker (card route reading p=), SavedViewButton.tsx, analytics/track.ts (currentPath already strips query and hash)

**Risks:** Some chat apps truncate long URLs. Old links need token tables kept per version. Different aspect ratios need fitFraction. The 'from a friend' label is unauthenticated; it is only a label, with no identity.

**Honesty:** The pill says 'replay' and 'illustrative', and the recipient sees the true coordinates. Links carry no identity, no free text and no user-uploaded structures.

**Judges:**

- E 4/merge: Merge into R2-capture-share-loops-03. The URL-fragment replay is the cheapest share in the set: no storage, no GPU encode, and the fragment never reaches the server or analytics. It depends on the kernel being input-deterministic, and deflate-raw CompressionStream support should be verified per browser. *Improve:* Ship it as capture-03's 'live link' output with a strict ≤2 KB parser. Fall back to plain base64url if deflate-raw is missing.
- P 4/merge: A recipient watching the sender's spin live, then taking the baton, is the best show-a-friend mechanic in the set, but capture-03 already contains it. Host: R2-capture-share-loops-03. *Improve:* Merge it as capture-03's live-link half, keeping fragment-only storage and the 'Reply' ending.
- A 3/merge: Host: R2-capture-share-loops-03. Re-performing the sender's replay live in the recipient's own viewer is clever, but visually it is the same as cap-03's live link. *Improve:* Merge into cap-03's link half. The p= unfurl card should be sig-06 ink at the start pose.
- Pr 4/merge: Merge into R2-capture-share-loops-03. The recipient re-performs the sender's gesture from a link that needs no storage and holds no text, then takes the baton. No viewer offers that referral mechanic today. capture-03's live link duplicates it. *Improve:* Merge, and keep the fragment-only, analytics-invisible payload as a hard privacy rule.
- M 2/rework: The recipient's viewer auto-performs the sender's spin on open, so the camera moves without the recipient's input. That breaks PE-10's rule 0 and WCAG 2.2.2, and no reduced-motion path is stated. *Improve:* Fix per CS-13: poster first, play only on tap, a visible Stop, and a storyboard of settle stills under reduced motion. Then fold it into CS-03 as its live-link half.

<a id="r2-first-minute-flagship-11"></a>
## The Stills Minute: reduced motion gets its own storyboard of designed stills, crossfades and a contact-sheet share
`R2-first-minute-flagship-11` · system · effort M · judges mean **3.6** (E3 P3 A4 Pr3 M5; champion 1, keep 2, merge 2) · self-scored fun 3 / visual 4 · perf improves

> Under prefers-reduced-motion, every beat of the first minute is re-authored as one designed still per action: detent-to-detent crossfades, a mode diagram instead of ringing, and an exploded-view plate instead of a burst. The share is a four-frame contact sheet instead of a video.

**Framing:** problem->solution

**Builds on:** C002 (one still per action) + C030/C028/C073 (their reduced-motion paths designed rather than skipped) + C049 (Illustrate) + C105 + C112

**Problem:** Round 1's reduced-motion answer was usually 'skip' (C030: 'reduced motion skips it'). That gives motion-sensitive visitors a worse, emptier minute and no share at all. The mobile judge asked for 'one still per action', but nobody designed the stills, the crossfades, or what replaces a video.

**Solution:**

RULES.
- User-driven 1:1 manipulation stays: a drag that follows the finger is not animation.
- Anything that continues after the input ends becomes a still plus an opacity crossfade of 150 ms or less.
- Each action renders exactly one new frame (demand frames, one invalidate).
- A 'Step' button pair is always offered, for visitors who want no drag-driven motion at all.

BEATS.
- Hero: still at the hero pose. Spin follows the finger; on release the nearest detent appears via a 120 ms crossfade, with no coast. Arrow keys step detents.
- Open: a 150 ms stage crossfade replaces the View Transition morph.
- Arrival: the SVG still crossfades into the 3D still at the identical pose, which the Match Frame Kit makes nearly invisible. No inflate.
- Flick: no coast. Release crossfades to the next detent in the flick's direction.
- Poke or pluck: a still mode diagram. Per-atom displacement arrows for the excited mode are drawn as a DOM overlay with a caption ('Breathing mode: every atom moves outward and inward together'). The chord still plays if sound is on, because sound is not motion.
- Unbaked ripple: a still highlight ring on the tapped atom and its 1-2-hop shell.
- Burst, in later minutes: an exploded-view plate, with atoms at 1.6× radius and hairline leaders to their true positions, crossfaded in and out. A technical illustration, not an animation.
- Replay: a 2×2 contact sheet (start pose, detent, mode diagram, end) in the Illustrate card template as a PNG. It is offered to everyone as the light share format.
- Replay links: the recipient steps through the sender's four key poses with 'Next ›'.

CROSSFADE TECHNIQUE.
- v9: a CSS opacity dip of the canvas through the plate colour (2 × 75 ms). No frame snapshots and no toBlob.
- After R6: TSL transition() between the previous and current render targets.

**Experience:**

PHONE, with Reduce Motion on: the buckyball still turns under your finger, but when you let go it simply appears at the nearest pentagon. A tap shows a crisp diagram of how the cage breathes, and the share is a neat four-panel card.
DESKTOP: the same, and the arrow keys step through views without any in-between motion.
SCREEN READER: every still has a one-line description; the diagram caption doubles as alt text.

**Tech:** prefersReducedMotion() (lib/spring.ts:77) and matchMedia. DOM SVG overlays. Canvas2D compositing for the contact sheet. After R6, TSL transition(). After R7, scheduler demand frames. The orbit kernel's motionScale = 0 enables step mode.

**Backend:** DOM/CPU on v9; [GPU+GL2] for the in-canvas transition after R6

**Rides (v10 requirements):** v9: none; post-port: R6, R7

**v9 slice:** Everything except the in-canvas transition node: step mode, diagrams, the exploded plate, the contact sheet, and the CSS dip crossfade.

**WebGL2 fallback:** transition() is a fullscreen pass, expected to work on GL2 but unverified node by node. The CSS dip remains the fallback everywhere.

**Where in code:** lib/spring.ts:77 (prefersReducedMotion), landing PocketHero, motion/orbitKernel.ts (step mode), new share/contactSheet.ts, new components/ModeDiagram.tsx, app/ViewerScene.tsx

**Risks:** It is a second authored surface that must be kept in sync, so the contract test enforces it. Some vestibular users want no drag-driven motion either, which the Step buttons cover. Mode arrows need careful styling so they don't read as forces.

**Honesty:** Diagrams are labelled 'computed mode shape (method)'. The exploded view is labelled 'positions spread for clarity; not the structure'.

**Judges:**

- E 3/merge: Merge into R2-play-for-everyone-11. The rules are right (1:1 drag is not animation; one invalidate per action), but a second hand-authored storyboard will drift from the motion one. The contact-sheet share is extra scope. *Improve:* Express it as each toy's still() in play-11's manifest, and let the contract test enforce it.
- P 3/keep: Designed stills, crossfades and a contact-sheet share beat 'skip the animation' and keep reduced-motion visitors inside the fun. For most strangers it's not a toy, but it's real craft. *Improve:* Author the flagship beats first, and share the one-still-per-action contract with the toy manifest (port-08).
- A 4/keep: Reduced motion becomes an authored visual path: exploded-view plates, mode diagrams and a contact-sheet share. This is design, not deletion, and it will produce some of the best stills in the product. *Improve:* Draw every still in the Illustrate voice (sig-06), so the reduced-motion path looks like the print voice. Enforce it through play-11.
- Pr 3/merge: Merge into R2-play-for-everyone-11. Designed stills and a contact-sheet share are necessary accessibility work. As a separate authored surface, though, they will drift out of sync. *Improve:* Make its per-beat stills the first entries registered under the toy access contract.
- M 5/champion: The only idea that designs the reduced-motion minute instead of skipping it: 1:1 drag kept, anything that continues after input becomes a still plus a crossfade of 150 ms or less, Step buttons for users who want no drag motion at all, a mode diagram instead of ringing, and a contact-sheet share. Almost all of it is v9. *Improve:* Make it the reference implementation of PE-11's still() contract, test it in FM-13's CI, and add a Step control that works with switch access. Crossfade opacity only, with no scale or zoom.

<a id="r2-first-minute-flagship-12"></a>
## First-Minute Telemetry: PII-free activation and delight events with a locked key list
`R2-first-minute-flagship-12` · foundation · effort S · judges mean **3.4** (E4 P3 A2 Pr5 M3; champion 1, keep 4) · self-scored fun 1 / visual 1 · perf neutral

> Eleven enum-only events and one end-of-session summary beacon measure time-to-first-rotate, first poke, sound opt-in, first replay and first share. A unit test pins every key past Lupi's PII filter, which today silently drops keys such as 'chip', 'tip' and 'molecule_name'.

**Framing:** problem->solution

**Builds on:** C014 (feel metrics) + C016 (tap-to-first-frame) + the round-1 gap 'PII-free delight events'

**Problem:** Analytics has about 14 funnel events. MOLECULE_INTERACTED fires once per file on OrbitControls onStart, and nothing measures the hero, the load seam, a poke, sound, replay or a share of motion; round 1 flagged 'no delight events'. The PII filter in track.ts, /(email|…|name|…|address|ip\b|uid|…)/i, drops keys by substring. Run against the real regex, 'chip', 'tip', 'first_tip', 'fluid', 'guid', 'ship', 'molecule_name', 'filename' and 'ownership' are all dropped silently, so a delight event with a replay_chip prop would lose that prop without any error.

**Solution:**

EVENTS, added to ANALYTICS_EVENTS. Props are enums, buckets and booleans only.
- hero_touched {verb: spin|tap|key, since_land: bucket}
- hero_opened {via: hero|tile|finder|key, prefetched: bool}
- viewer_ready {ms_tap_to_frame: bucket, relay: bool, arrival: inflate|condense|crossfade|none, backend: webgpu|webgl2|webgl}
- first_rotate {since_ready: bucket, input: touch|mouse|trackpad|key}
- first_flick {speed: lt05|05to1|1to2|gt2 rev/s, detent: bool}
- first_poke {response: pluck|ripple|torque, hinted: bool, since_ready: bucket}
- sound_opt_in {from: hear|settings}
- hint_shown {rung: 0-7, reduced_motion: bool}
- replay_opened {trigger: moment|menu}
- clip_shared {format: mp4|png_sheet|link, method: native_share|copy|download, encode: bucket}
- arrival_interrupted {by: touch|key}
- first_minute_summary, one sendBeacon on pagehide: {verbs_mask, ms_first_rotate, ms_first_poke, ms_first_share, dead_taps, reduced_motion, sound, backend, arm}
All timings use log2 buckets (≤250 ms, ≤500 ms, ≤1 s, ≤2 s …) so they can't fingerprint anyone.

KEY VETTING. A vitest runs every declared key through stripPii and fails if any is dropped. Values never contain free text, coordinates, gesture paths, replay logs or search text. Molecule identity is a curated gallery_id, or 'other'.

METRICS.
- Activation: first_rotate within 10 s of viewer_ready.
- Delight: first_poke AND (sound_opt_in OR replay_opened).
- Share rate: clip_shared divided by sessions with viewer_ready.
- Guardrails: the dead_taps rate; the arrival_interrupted rate (if high, shorten the entrance); ms_tap_to_frame p75 by backend; render_failed.

EXPERIMENTS (the arm prop): hero on/off (which measures the owner's motion call), C60 versus caffeine hero, touch mark versus text pill, and Replay chip on/off.

MOLECULE_INTERACTED is kept unchanged so existing dashboards survive.

**Experience:** Invisible to visitors on phone and desktop. The owner gets a funnel from 'saw the hero' to 'sent a replay', split by input type (touch, trackpad, keyboard) and by reduced motion, so the accessible paths are measured as first-class funnels.

**Tech:** The existing analytics/track.ts (sendBeacon text/plain, stripPii, path without query or hash), events.ts, session.ts (sid, isReturning), vitest.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it.

**WebGL2 fallback:** Not applicable. The backend is recorded as a prop, so the GL2-fallback funnel is visible.

**Where in code:** packages/ui/src/analytics/events.ts, track.ts:24-80 (PII_KEY_PATTERN, stripPii), analytics.test.ts, app/ViewerScene.tsx:746, LandingShell.tsx:12-14, SavedViewButton.tsx:251-294, new motion/*

**Risks:** It grows the taxonomy beyond the '~12 names' principle, so keep the new events together under one first-minute section. Beacon loss on iOS pagehide. Consent handling stays as today, with the Firebase sink opt-in.

**Honesty:** It measures behaviour only, in buckets and enums, and holds no PII. It never ships gesture logs.

**Judges:**

- E 4/keep: Small, ships on v9, and it found a real bug: the PII filter silently drops keys such as 'chip' and 'molecule_name'. A unit test that pins keys is exactly right. Recording backend as a prop makes the ~13% GL2 funnel visible, which no perf claim can do without. *Improve:* Land it with capture-14 as one taxonomy PR, and add a first-interactive-frame bucket from port-06.
- P 3/keep: Not fun, but it's how we'd learn whether anyone smiles: time-to-first-rotate, first poke, sound opt-in, first share. The PII-filter key test catches a real bug. *Improve:* Absorb capture-14's share events into one locked taxonomy, and add toy_first_use plus a returned-next-day bucket.
- A 2/keep: Outside my lens. It adds no visual cost and I have no objection. *Improve:* Add a look_switched event, and record whether each first flick landed on a detent.
- Pr 5/champion: Nothing in the fun layer can be judged without this. It is small, ships on v9, and found a live bug I confirmed: the PII regex in track.ts drops any key containing 'name' or ending in 'ip', so 'chip', 'tip' and 'molecule_name' are silently lost. It hosts capture-14. *Improve:* Land it first, with capture-14's share funnel folded in as one taxonomy and a unit test on the key list. Declare a North Star, such as the share of sessions that reach three verbs or a first share.
- M 3/keep: Enum-only, PII-free, and the backend prop makes the GL2-fallback funnel visible for the first time. *Improve:* Add enum props for the comfort setting (standard, gentle, still, os-reduced) and input modality (touch, mouse, key, switch-like), so the accessibility funnel is measured. Share one taxonomy with CS-14.

<a id="r2-first-minute-flagship-13"></a>
## First-Minute Contract: a scripted stranger in CI that fails the build when the choreography rots
`R2-first-minute-flagship-13` · foundation · effort M · judges mean **3.2** (E4 P2 A3 Pr3 M4; keep 4, merge 1) · self-scored fun 1 / visual 1 · perf neutral

> One Playwright spec drives the whole minute: spin the hero, tap, catch the relay, check the match frame, time the arrival, poke, replay twice. It asserts zero canvases on /, no dead splash, an arrival of 600 ms or less with live input, one frame per action under reduced motion, deterministic replays and clean telemetry, on the WebGL lane now and on both R11 lanes after the port.

**Framing:** problem->solution

**Builds on:** C014 + C019 (CI smoke) + C005 + C002 (zero idle frames) + R11

**Problem:** Choreography rots silently: a palette tweak breaks the match frame; a new loading state brings back a splash; a numeric scheduler priority reverses order (the R7 trap) and replays drift; a new event key is dropped by the PII filter; a deformer leaks into export. Nothing in CI knows the first minute exists, and C019's 'ghost as smoke test' was never specified.

**Solution:**

tests/ui/first-minute.spec.ts, run in mobile and desktop projects.
1. /: zero canvases (the existing assert), no request for the App chunk before an intent, and zero hero rAF callbacks before input.
2. Hero: a synthesized pointer drag changes transforms. After release, the settle ends on a manifest detent within the kernel's analytic settle time ±1 frame, and rAF then stops.
3. Relay: a tap creates the relay node. A pixel probe confirms #020204 is never painted. Under a throttled network, the stage still accepts a drag during the load.
4. Match frame: at handoff, compare the stage SVG against the first canvas frame. Disc centroids within 1 px at 400 px, radius within 3%, ΔE2000 below 6.
5. Arrival: 600 ms or less from first frame to settle, measured with an injected debug clock. A pointerdown at 100 ms rotates the camera. A second open in the same session plays the short variant.
6. Tap router: catch while coasting, poke at rest, no-op on empty space. With a measurement tool armed, the router yields.
7. Reduced motion (emulateMedia): each action increments renderer.info.render.frame by exactly 1, plus crossfade frames where in-canvas, and there is no coast.
8. Replay: re-performing the same log twice gives identical frame hashes on the same backend. The MP4 decodes to the expected frame count. Send stays disabled until the File exists.
9. Telemetry: intercept sendBeacon; every key survives stripPii, and there are no string values outside the enums.
10. Export isolation: a deterministic export requested mid-arrival or mid-pluck produces bytes identical to a rested export.
11. Ladder: the touch mark's data-target coordinates are used to perform each rung.

ms_tap_to_frame and settle times are recorded as trend metrics, not pass/fail FPS claims. Debug hooks are compiled out of production.

**Experience:** Invisible to visitors. It protects the arc on phone and desktop through the 4 to 5 months of port work. The reduced-motion and keyboard paths are asserted, not assumed.

**Tech:** Playwright (existing configs), page.emulateMedia, CDP network throttling (Chromium), resvg goldens, Mediabunny demux for MP4 checks, an injected debug clock behind a test flag.

**Backend:** mixed

**Rides (v10 requirements):** R11 (dual lanes) after the port

**v9 slice:** The WebGL lane now, with the WebGPU SwiftShader and fallback lanes added with R11.

**WebGL2 fallback:** It runs in both R11 lanes with per-lane colour tolerances.

**Where in code:** tests/ui/student-surface.spec.ts:9 (zero-canvas assert), new tests/ui/first-minute.spec.ts, playwright.config.mjs, tools/verify-*.mjs (pattern), ExportManager.tsx (export-isolation hook)

**Risks:** Flaky timing in CI (use the injected clock). SwiftShader colour differences (per-lane goldens). Test hooks leaking into production (a build flag strips them).

**Honesty:** It asserts that the fun layer never reaches deterministic export, which turns the honesty rule into a test.

**Judges:**

- E 4/keep: A scripted stranger in Playwright is the regression net the port needs. It uses an injected clock, zero hero rAF before input, zero idle frames, a pixel probe that the #020204 black splash never paints, and one frame per action under reduced motion. It rides R11's dual lanes. *Improve:* Drive it from port-12 Replay Tape files so CI and user replays share one format. Freeze per-lane SwiftShader tolerances and strip test hooks by build flag.
- P 2/merge: A scripted stranger in CI protects the choreography but makes nothing fun, and it duplicates the Replay Tape's CI role. Host: R2-port-as-toy-engine-12. *Improve:* Express the first minute as a tape replayed in both R11 lanes, not as a bespoke spec.
- A 3/keep: A scripted stranger in CI that asserts the match frame and that #020204 is never painted guards the choreography, not just the function. *Improve:* Assert velocity continuity (no visible C1 kinks) and an overshoot bound per motion token, not only settle time.
- Pr 3/keep: It stops the choreography from rotting and enforces zero canvases on /. But a large, brittle end-to-end spec written before the choreography exists will churn. *Improve:* Grow it from Replay Tape recordings, starting with only the zero-canvas and no-dead-splash asserts.
- M 4/keep: CI that asserts zero canvases on /, no dead splash, an arrival of 600 ms or less, and one frame per action under reduced motion writes my lens into the build. *Improve:* Add an axe-core pass, a keyboard-only run, forced-colors and prefers-contrast emulation, CPU-throttled mobile profiles, and an injected 33.3 ms rAF cadence to test the LPM path.

<a id="r2-first-minute-flagship-14"></a>
## Variant arc — The Vanishing Ring: the search-first minute that ends with 'your coffee is flat'
`R2-first-minute-flagship-14` · flagship · effort S · judges mean **3.6** (E3 P4 A4 Pr4 M3; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> For visitors who type instead of touching (the landing is search-first), the minute runs on caffeine. The finder row's thumbnail flies into the viewer, the molecule condenses from its signature cloud, and the payoff is a flick to the edge-on view where all 14 heavy atoms collapse into a line. Caffeine's skeleton is flat to ±0.001 Å in the shipped file.

**Framing:** problem->solution

**Builds on:** C030 + C021 + C017 (condense on a typed pick, inside the viewer) + C038 (observation as a goal) + curated prompts (benzene, caffeine)

**Problem:** The flagship assumes a thumb on the hero, but LandingPage leads with MoleculeFinder ('Search first'), and a C60 cage is abstract to many strangers. Typed arrivals need a second authored arc: a molecule people already care about (the landing even says 'your coffee'), with a different climax so the A/B arms are genuinely different experiences.

**Solution:**

BEATS, PHONE:
- 0 s: type 'caf'. The local match is instant. New: the result row shows the 32 px /learn/caffeine.svg.
- ~3 s: tap the row. A View Transition carries the row thumbnail to the relay stage.
- ~4.5 s: the Arrival Router picks GAS, because a planar skeleton makes FLAT a no-op. Caffeine condenses bottom-up from its seeded cloud in 600 ms or less.
- 5 to 15 s: flicks settle on PLANE_FACE, PRINCIPAL and PLANE_EDGE detents. At the first face-on rest the label reads 'Face-on: the fused rings'.
- When a flick lands edge-on, the label reads 'Edge-on: all 14 carbon, nitrogen and oxygen atoms lie in one plane (±0.001 Å in this file). Only the methyl hydrogens stick out.' This is the 'wait, it's flat?' moment.
- ~25 s: tap an atom. On v9, poke torque. After R3, C028's crisp ripple, or baked modes if caffeine is among the 10-20 baked heroes.
- ~40 s: the Replay chip. The six-second vanish is the share.
- ~55 s: 'Next: benzene — flatter still' or 'Next: the buckyball'.
TRACKPAD: type, Enter, then two-finger swipe to edge-on; or press the arrow keys from face-on to edge-on, with each view announced.
HOW IT DIFFERS FROM THE BUCKYBALL: the arrival is the house condense, not the inflate; the climax is an observation (flatness), not sound; and the four elements make the Match Frame palette decision visible, so it can't ship before that call.
A/B: the entry point assigns the arm (finder gets the Vanishing Ring, hero gets the Buckyball). Compare first_poke, replay_opened and clip_shared per arm.

**Experience:**

PHONE: you type 'caf', tap, and your coffee's molecule condenses out of a small cloud. You flick it and it turns edge-on into a thin line with a few hydrogens poking out, labelled with the real flatness.
DESKTOP: Enter from the finder; arrow keys hop face-on to edge-on.
SCREEN READER: the finder row reads 'Caffeine, C8H10N4O2, 24 atoms'. The detent labels carry the observation, so it works without sight.

**Tech:** Finder row thumbnails from /learn/<id>.svg. Arrival Router GAS through the v9 uProgress hook. PLANE_EDGE detents and planarity measured offline in the preview builder (benzene 0.000 Å; caffeine heavy atoms 0.001 Å; methyl hydrogens up to 0.90 Å out of plane).

**Backend:** mixed: DOM/CPU (finder, relay); [GPU+GL2] after the port

**Rides (v10 requirements):** v9: uProgress; post-port: R3, R4

**v9 slice:** Everything except the ripple, which is poke torque on v9.

**WebGL2 fallback:** Same as the flagship: closed-form deformers on the GL2 backend after the port, and camera-only detents everywhere.

**Where in code:** landing/MoleculeFinder.tsx (row thumbnails, openLocalMolecule at :28 and :107), landing/moleculeIndex.ts (image paths), tools/build-gallery-previews.mjs (planarity and detents), gallery/studentCollection.ts (caffeine and benzene prompts), motion/arrival.ts

**Risks:** Typing is friction on phones. Methyl conformations vary between files, so every statement must be scoped to 'this file'. The arc depends on the palette call. Search results for PubChem molecules (not curated) get the plain cold arrival and generic detents.

**Honesty:** Planarity is measured from the shipped computed structure and says so. There is no claim about crystal or solution geometry.

**Judges:**

- E 3/merge: Merge into R2-first-minute-flagship-01 as its search-first arm. The caffeine edge-on payoff rests on offline-measured planarity and is cheap (uProgress GAS plus camera detents), but it is a variant, not a separate system. *Improve:* Make it the A/B arm for typed-first visitors inside flagship-01's storyboard.
- P 4/keep: 'Your coffee is flat' is a genuinely funny, shareable aha, and it meets the search-first majority where they are. Typing on a phone is friction, and the payoff depends on the edge-on view being easy to land. *Improve:* Make edge-on caffeine's beginner's secret, with a wide capture cone. Pre-suggest 'coffee' in the finder, and run this as the A/B arm to C60.
- A 4/keep: Caffeine collapsing to a line when seen edge-on is a striking composition and a real observation, and caffeine brings the colour the C60 arc lacks. *Improve:* Run it as the co-equal A/B arm. Narrow the FOV at the PLANE_EDGE detent so the line reads as a line, not a perspective wedge.
- Pr 4/keep: It rides the real landing, which is search-first per the contract and already has 72 /learn SVGs (verified). It needs no approval for home motion. 'Your coffee is flat' is a relatable fact scoped to this file, which makes caffeine a stronger arm for strangers than C60. *Improve:* Run it as an arm of the flagship A/B alongside Water. Scope every statement to 'this file'.
- M 3/keep: The search-first path is also the natural entry for keyboard and screen-reader users, and 'flat' is stated as a fact. Typing is friction on phones, though. *Improve:* Make the finder a proper combobox/listbox with announced result counts, and give the edge-on payoff as a text line ('14 heavy atoms lie in one plane') as well as a camera move.
