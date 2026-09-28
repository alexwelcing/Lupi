# Round 1 review: Lupi viewer brainstorm

2026-09-27. Synthesis of five judges (engineer-v10, playtester, art-director, product-steward, mobile-a11y-realist) scoring 119 canonical ideas deduped from 180 round-1 ideas. Baseline: R3F v10 alpha plus pmndrs `math` 0.1.0 (see `research/01-v10-baseline-brief.md`, `research/00-fact-sheet.md`). Goal: faster, more visually powerful, and above all fun for casual desktop and phone visitors.

**Tier counts:** 19 champions, 30 strong standalone, 25 folded into a host idea, 17 rework, 22 parked, 6 killed (119 total).

---

## 1. Headline

**What round 1 got right**

- **Feel before features.** The three highest-scoring ideas are all about the first gesture: C021 flick, C003 motion kernel and C028 poke ripple, each with a mean of 4.8, no kills, and C003 with the most champion votes (5). All five judges agree that the first drag and the first tap decide whether Lupi is fun.
- **Much of it ships before the port.** C003, C021, C002 (scheduler 0.2.0 works on v9), C014, C062, C072, C088, C110, C015 and the prefetch half of C016 ship on v9, well ahead of the 4-5 months of v10 parity. The engineer also found a zero-GLSL slice: v9 already interpolates atoms and bonds by `uProgress`, so the condensation entrance (C030), the reel morph (C118) and the atom recycler (C077) have v9 versions.
- **The honesty contract becomes a platform.** C027 (one display-offset layer that the picker, labels and bonds all sample, and that export zeroes) is what lets every touch toy be fearless. The engineer's refinement is to make deformers closed-form `f(base, t, uniforms)` with CPU twins. That makes the contract cheap and gives motion vectors for free.
- **Two share loops are half-built.** The product steward confirmed that iPhone Quick Look is built but never triggered (`setIsExportingQuickLook` is only ever set to false), and that every link unfurls with the same `og-lupi.png`. C110 and C106 are mostly wiring.

**What round 1 missed**

- **Nobody owns the gesture grammar.** Every judge flagged this. Tap (pick, poke, pluck, catch, hunt), double-tap (glide, burst, zoom, shatter), long-press (loupe, wheel, tug, lift, heat) and one-finger drag (orbit, wake, knife, lasso, wipe) are each claimed by 3-10 ideas. There is no arbitration map and no playtest of one.
- **Toys can't be found, and play isn't accessible.** Apart from a ghost hand and a hidden long-press wheel, nothing makes toys discoverable. Only 2 of 180 raw ideas mention screen readers. Nothing proposes a keyboard atom cursor, a flash guard, a motion-sickness budget or one shared sensor-permission flow. The viewer has no keyboard camera control today.
- **Nothing is measured.** There is no real-device FPS or thermal data and there are no delight events. The quality ladder (C004), the fun budget and every phone claim are tuned to guesses until C014 exists.
- **Engineering hazards of the fun layer were skipped.** Nobody plans pipeline prewarm (#33821 slow material init), `GPUDevice` loss recovery, a per-atom memory budget, velocity for displaced atoms, a lazy toy registry or bundle budget, or precision at extreme zoom.
- **Looks sprawled and some games had no molecule in them.** There were about 20 look ideas, some of them stock shader tropes (C047, C059, C034), and the arcade games with no chemistry scored lowest (C099, C102, C097, C098). There is no house style spec to judge Looks against.

---

## 2. Tiers

Scores are listed as `mean · E/P/A/Pr/M` (engineer / playtester / art-director / product / mobile-a11y). Every canonical id appears exactly once below.

### 2.1 Champions (build)

**A. v9 feel and foundations (ship before the port)**

- **C003 One Motion Kernel** · 4.8 · 5/4/5/5/5. Unanimous, with 5 champion votes. Build it as the camera controller that C021 needs: the engineer notes that OrbitControls damping runs per `update()` call, so dt-correct damping means owning the controller. Publish 4-5 named motion tokens, including an underdamped "boing", plus a settle-epsilon helper and a global `motionScale` for reduced motion. Add a unit test for settle time at 30, 60 and 120 Hz and a lint rule against per-frame lerps.
- **C021 Fidget Flick** · 4.8 · 5/5/4/5/5. Top-10 votes: 4, the highest of any idea. It absorbs C022's 1:1 tracking and dolly-to-cursor and C023's rubber-band limits. The playtester and art director disagree about the rev/s dare: the playtester wants a spin record, the art director wants it dropped. The fix is to make the record a quiet, opt-in mastery layer. Keyboard: arrows step between detents and Home resets.
- **C002 Quiet Idle on One Clock** · 4.2 · 5/3/3/5/5. Sharp split. The engineer, product steward and mobile judge call it the biggest battery win. The playtester says a frozen molecule reads as dead, and the art director warns that springs cut off early snap on the last frame. The fix answers both: sleep only after an analytic settle of under half a pixel, and pair it with one short breathing invitation (reworked C020). Lint numeric priorities out, since they run in reverse order, and add a CI assertion of zero idle frames.
- **C014 Device Lab, ?perf HUD and CI perf contract** · 4.2 · 5/3/3/5/5. The same split: three judges say no perf claim in the list can be tested without it. Its first deliverable is the gate spike's benchmark tour on named phones (iOS 26 WebGPU, iOS 17/18 on the GL2 fallback, a mid-range Android, a Low Power Mode run). Add feel metrics (input-to-photon, settle time, hitches per flick) for the playtester and look goldens for the art director. It absorbs C005's hygiene budgets.
- **C016 No Dead Splash** · 4.4 · 4/4/5/5/4. Ship intent prefetch now (S). Trigger it on a pointer held for 100 ms or a tap without scroll, and honour Save-Data, because the mobile judge warns that touchstart prefetch burns data on every scroll. The FLIP-and-inflate follows R3. Carry spin momentum across the seam (playtester), and cut to two art-directed seams (art director).
- **C015 Pocket Molecules on Home** · 4.2 · 4/5/4/4/4. The playtester champions it as the only touchable thing on `/`. It needs an owner call, because it brings motion back to a home page the reset deliberately calmed. Start still and move only on touch. Use `touch-action: pan-y` with an edge dead zone and arrow keys on focused tiles. Keep speculars fixed to the key light and halve the wobble.
- **C062 Remix Codes that Morph** · 4.4 · 4/5/4/5/4. The integer-exact codec ships on v9 in `packages/core` with golden tests. The art director's condition: sample only from C048's curated look manifold, because random remixes are often ugly. The Remix button is primary and shake is secondary. It absorbs C107's lineage.
- **C072 Honest Thermometer** · 4.4 · 4/4/4/5/5. Real LAMMPS runs, a v9 build, and screen-reader friendly. Blend blackbody colour over element colour, label it as a temperature colour map rather than emission, and cite Tm. Use aria-valuetext such as "1358 K, melting". It is the honest anchor that illustrative heat (C033) hands off to.
- **C088 Lupi Daily** · 4.4 · 4/5/4/5/4. The only strong come-back-tomorrow loop. Ship it as a DOM card on v9 and add the viewer reveal after R3. Add a ladder of text clues so it works without sight (mobile judge), and curate a 60-day queue. It absorbs C089 and C090 as rotating formats.
- **C110 On My Desk (one-tap AR)** · 4.2 · 4/4/3/5/5. Quick Look is built and unwired, so this is mostly wiring. Ship the iPhone button on v9 and cap USDZ size for large molecules. The art director wants PBR materials and a contact shadow. Defer hosted postcards until R2 storage has a cost owner.

**B. Share loops**

- **C103 Perfect Loop Clips** · 4.4 · 5/4/4/5/4. The v9 slice is `advance()` plus a fixed-size target plus Mediabunny. Encode from `readRenderTargetPixelsAsync` buffers, because a VideoFrame from a WebGPU canvas on Safari is unverified. Ship three art-directed templates with a Lupi end frame. It absorbs C112's one-tap reel. The playtester's "share what I just did" becomes the Instant Replay spark.
- **C106 Real Share Cards** · 4.2 · 4/3/5/5/4. Generate a Satori edge card from the saved view's coordinates first (no client upload, no new storage), then client captures after R9. Generate og:image:alt from name, formula and look. Use one Illustrate-look template.

**C. The port with hooks, and the toys that ride it**

- **C001 Lupi on v10: the TSL toy engine** · 4.0 · 5/3/4/4/4. The port is mandatory; the only decision is which hooks go in. Limit them to the offset buffer (zeroed in export), the R2 flag byte, an RGBA8 ID target and the mood bus. Defer `positionPrevious` and TRAA until the gate spike reports. Add a look-parity golden set (art director), run the gate spike on phones (mobile judge), and use the poke ripple and burst as the demo that parity is done (playtester and product steward).
- **C027 Deform Stack with an Honesty Contract** · 4.2 · 5/3/4/5/4. The playtester would merge it into C001. The engineer's fix is central: deformers are closed-form with CPU twins, and a sparse stored buffer is used only for IK and tug. Labels and the picker evaluate the same function, and velocity comes free. The "illustrative motion" chip doubles as the Play control and a one-tap reset. Add a CI test that export bytes are identical with deformers active.
- **C009 GPU ID Picking** · 4.2 · 5/4/4/4/4. Ship the picker as port infrastructure, separate from the toy wheel. Pack IDs into RGBA8, because GL2 integer readback is implementation-defined. On touch, read a finger-sized patch of about 9x9 px from a scissored pass rendered only on tap. Use one restrained hover signature (art director). The long-press wheel goes to the gesture-grammar work.
- **C028 Jelly Molecule** · 4.8 · 5/5/4/5/5. Ship the crisp poke ripple first (about 400 ms) as the demo that parity is done. One touch-field shader function absorbs C029's wake and C034's shockwave. Put shake and tilt behind one sensor-permission flow. The art director wants tilt sag dropped.
- **C030 Dandelion Burst and Condensation Entrance** · 4.6 · 5/5/5/4/4. The v9 slice needs no new GLSL: upload a seeded gas cloud as the "from" frame on the existing `uProgress` hook. Play the entrance on the first open per session only, cancel it on any touch, and keep it under 600 ms. Move the burst off the contested double-tap. It becomes the house "condense" motif and absorbs C017.
- **C048 Look Space and the Look Pad** · 4.4 · 4/4/5/4/5. The engineer's caveat: `select()` evaluates both branches, so use `If()` on uniforms and blend at most two looks. Art-direct the midpoints, and keep additive and OIT looks outside the continuous space. Put the pad on the canvas (playtester) and make it keyboard-operable (mobile judge). It hosts C008, C051, C053 and C055.
- **C073 Pluck a Molecule** · 4.2 · 4/5/4/4/4. Bake 10-20 hero molecules with a versioned modes manifest (method, version, frequency scaling) and show an "xN" amplitude chip. Tap ownership follows the gesture grammar: tap plucks where modes are baked and ripples elsewhere.

### 2.2 Strong (keep)

**Keep as standalone**

- **C004 Measured Quality Ladder** · 3.8 · 4/3/3/4/5. The mobile judge champions it; the others say not before device data. Start with a hand-rolled sampler and two rungs (DPR and render scale). Detect Low Power Mode's locked 33.3 ms cadence, calibrate after the `compileAsync` warm-up, and change rungs only at rest. It absorbs C006 and C087.
- **C010 Bonds in a Blink** · 3.2 · 4/2/3/3/4. Ship the typed-grid worker on v9. Grow bonds out from atom centres over about 250 ms, so late arrivals read as choreography (art director). Use fixed max-bonds-per-atom slots on the GPU path.
- **C019 Ghost Hand Demo** · 3.8 · 4/4/3/4/4. The art director would rework it, because a translucent hand is a mobile-game cliché. Replace the hand with an abstract touch mark. Ship a flick-only version on v9, A/B it against the text pill, and reuse it as an end-to-end CI smoke test.
- **C025 It Notices You** · 3.6 · 4/4/4/3/3. Cheap and camera-only. Cap it at ±3°, lean only before the first interaction and pause it during measurement (product steward). Keep tilt opt-in, off under reduced motion, with a visible "sensor on" indicator (mobile judge).
- **C026 The Molecule Rides the Sheet** · 4.0 · 4/3/4/4/5. The mobile judge champions it because it fixes a shipping bug: the Style sheet resizes the canvas. Drive the view offset from the sheet's own drag progress, extend it to `visualViewport` changes, and test picking under `setViewOffset`.
- **C031 Tug, Taffy and Chain Puppet** · 3.6 · 4/4/3/4/3. Ship single-pointer tug with hop-distance falloff first. Show strain as visible tension (art director), and add MMFF94 later, labelled "illustrative pose". It absorbs C085 and reuses C098's FABRIK chain.
- **C035 Knife: Swipe to Split** · 3.8 · 4/4/4/4/3. Compute sparks in the bond shader from endpoint signs. Render the cut face as a clean technical section (art director). Offer a Knife chip plus keyboard plane presets. It absorbs C096 as its challenge mode.
- **C038 X-ray Box with a Live Formula** · 3.4 · 4/2/4/4/3. Split: the playtester would park it ("a feature with handles"), while the engineer, art director and product steward score it 4. Ship a v9 slice (box plus formula). On phones, use a sphere or slab centred on the tapped atom, and announce the formula through aria-live. To satisfy the playtester, recast it as a goal ("enclose exactly caffeine").
- **C041 Plink, Whoosh, Tick** · 3.8 · 4/4/3/4/4. The playtester champions it. Design sound first, with a caption for every cue. Since iOS 26.5, iOS haptics fire only from direct DOM taps. Fire cues from spring events so they land on the beat (art director), and decide the audio default. It absorbs C093.
- **C042 Pocket Worlds (Studio as a Look)** · 3.6 · 4/3/4/4/3. Scope v1 to "Studio becomes a Look", and port its 54 WGSL lines to TSL so it reaches GL2. Defer marble, lava lamp and galaxy. It absorbs C043.
- **C044 Light Painter** · 3.8 · 4/3/5/3/4. Split: the art director scores it 5, the playtester and product steward 3. Ship on v9 with a ghost sun gizmo that detents at classic setups, plus arrow keys. It becomes the host for the sky (reworked C058).
- **C045 Film Stocks** · 3.6 · 4/2/5/3/4. Split: the art director scores it 5, the playtester 2 (merge). Make Khronos Neutral the truthful default now; the installed postprocessing already exports it. Bake the films into LUTs so switching is a uniform lerp, because changing the tone-mapping operator rebuilds the output node. Add colour-blind-safe and high-contrast grades.
- **C046 Depth Atmosphere and Focal Slab** · 3.8 · 5/2/5/3/4. Split: the engineer and art director score it 5, the playtester 2. Turn fog on by default above about 50k atoms, tint it from the backdrop, and turn it off under `prefers-contrast`. The slab moves to C060.
- **C049 Illustrate (Goodsell look)** · 4.0 · 4/3/5/4/4. The art director champions it as the strongest candidate for Lupi's signature voice. Use RGBA8 ID edges, depth-only edges on GL2, and offer it as the high-contrast preset. Make it the house print voice for cards, the Daily, posters and stickers.
- **C050 Neon Glow, reframed as Highlight** · 4.2 · 5/4/4/4/4. The engineer champions it. Attach the emissive MRT and bloom only while a highlight is active, at half resolution on phones. Keep pulses under 3 Hz and add a forced-colors outline. Put it in the Elements panel as an inspection tool first.
- **C056 Billiard Balls, as element-letter decals** · 4.0 · 4/3/4/4/5. The mobile judge champions it: element identity without relying on colour. Make it an overlay any look can switch on. It is deterministic, so it is a V2 export candidate.
- **C060 Photo Mode, as the Specimen Camera** · 4.0 · 4/4/5/3/4. The art director champions it; the product steward flags L scope and overlap. Ship tap-to-focus plus the shutter only. The shutter is C061's tier-1 accumulation, bounded and then asleep, and its output goes to the capture service.
- **C063 Paint by Any Name** · 3.4 · 4/3/3/3/4. Land the hsl-to-grey bug fix as its own v9 PR now. Add Okabe-Ito presets and a "custom colours" badge. Drop party hue-cycling (art director) or cap its speed (mobile judge).
- **C065 Comet Tails** · 3.4 · 3/3/4/4/3. Ship tap-to-trail on v9 with the existing AtomTrails; today only annotated atoms get trails, which phones can't reach. Build tails as ribbons rather than on drei Trail, and auto-attach them to the fastest atoms.
- **C066 Matcap Bake** · 3.5 · –/2/4/3/5. Split: the mobile judge scores it 5, the playtester 2 ("an implementation trick"). It is the phone and far-LOD tier for every look (the Matcap LOD spark). Rebake it on light changes so Light Painter still works, and composite depth AO.
- **C067 Touch the Scan Cloud** · 3.6 · 3/4/4/4/3. Test the iPhone storage-buffer limit on a device first. The no-camera demo should open straight into touch mode. Use the shared condense tokens, and port to TSL later for GL2.
- **C076 Mirror, Mirror (chirality)** · 3.2 · 4/3/3/3/3. Niche but honest. Start with a turn-based "same or mirror?" round, run the fit on release, and tie it to real chiral molecules in the Library.
- **C078 Grow a Crystal** · 3.8 · 4/4/4/3/4. Seeded and shareable, with a glow on the growth front. Label it as a growth model (product steward) and end on the real crystal structure.
- **C080 Atom Smasher** · 3.2 · 3/4/3/3/3. Start with the existing `sand_w_cascade` run. Use comet tails instead of `afterImage` (art director), give each shot a goal (playtester), and honour Save-Data.
- **C084 Sink or Float** · 3.6 · 3/4/3/4/4. DOM on v9 with real handbook data. Let players drag the molecule into the glass, give the result as text, and cite sources.
- **C091 Find the Atom** · 3.4 · 3/4/3/4/3. Seeded hunts first, with a preset clue vocabulary so no free text travels in URLs. Phones need a finger-accurate picker (C009's patch or the loupe). It absorbs C092.
- **C094 Element Passport** · 3.2 · 3/4/2/3/4. Split: the art director would park it, while the playtester and mobile judge score it 4. Stamp the toys players discover as well as elements; that gives the discovery meter the playtester asked for. It absorbs C083's cards as stamps.
- **C105 Sticker Press** · 3.8 · 4/4/3/4/4. It hosts a "Make it mine" share sheet, with C104's wallpaper as a preset. Capture from a raw, post-free transparent pass, default to an Illustrate ink outline, and offer it right after a burst or a lucky roll.
- **C109 Tap-to-Wake Embeds** · 3.6 · 4/3/3/4/4. The poster is the C106 card and the wake is the C030 condensation. Mount on tap and unmount on scroll-out, because of the renderer leak (#3926).
- **C113 Fly It and Share the Flight** · 3.2 · 4/3/3/3/3. Camera-only and on v9. Ship the doodle-path version first, with caps on angular velocity and banking and a stills preview. It absorbs the probe-eye camera from the killed C102.

**Keep by folding into a host**

- **C005 Idle Hygiene Sweep → C014.** Budgets for allocation per frame and idle React commits become CI gates, so the fixes don't rot after the port.
- **C006 Develop on Release → C004** as its "interacting" rung. Use preallocated targets and a crossfade, and never enable it by default on desktop. `fsr1` gives no speed-up on GL2.
- **C008 Play Without the Flash → C048,** as an R6 acceptance test: no composer rebuild on Play or Remix. The engineer notes that a pass at weight 0 still costs full time, so pair uniform weights with prewarmed graph swaps.
- **C017 Type It, Watch It Form → C030** (the condense motif, with the gist cloud as the seeded start when available) and **C067** (the particle port). Disqualified on `/` as pitched.
- **C022 Glued to Your Finger → C021.** A unanimous merge. Build it on `math/time`, not camera-controls, which would fight the kernel.
- **C023 One-Thumb Mode → C021's** camera bundle. Keep the rubber band and the scale card (announced through aria-live) and drop the molecule squash (art director). Double-tap follows platform convention.
- **C029 Wake Behind Your Finger → C028,** a unanimous merge. It is the large-scene mode (a ping-pong trail texture) and a Play-mode drag verb.
- **C034 Tap Shockwave and Dive.** The shockwave goes into C028 as a post-only fallback for weak devices; the art director calls it a stock trope. The dive goes into C021 with an angular-velocity cap.
- **C043 Shake-to-Snow Globe → C042's** shake response. Sprite flakes run on both backends; piling is [GPU]-only. Add a Shake button and key.
- **C051 Gummy Candy Atoms → C048** as a signature look point. Keep chord absorption, drop refraction on phones, and fade the sparkle by pixel radius.
- **C053 Soap Bubble → C048** as the "next Prism". The product steward would park it; the playtester and art director score it 4. The opaque pearl is the default on GL2, on phones and above 20k atoms; OIT stays desktop-only.
- **C055 Claymation → C048.** Its on-twos ticking becomes the reference per-job-fps behaviour for idle and turntable. Direct manipulation stays at display rate.
- **C061 Rest-Frame Beauty → C060.** Tier 1 becomes the shutter. The path tracer is parked (every judge except the art director).
- **C083 Element Personality Cards → C094** as passport stamps and as cards on the Elements panel chips.
- **C085 Sticky Water → C031** as its water-cluster level, with H-bonds styled as inferred.
- **C087 Atom Juggler → C004** as silent calibration. Heating a phone on purpose is a thermal anti-pattern.
- **C089 Molecule Globle → C088** as a hint or hard mode. Show warmth as words, not only colour.
- **C090 Shadow Match → C088** as a rotating daily format, with keyboard rotation, detents and a pitch cue.
- **C092 Peekaboo → C091** as a hunt level. Check visibility with a downsampled ID-buffer scan, because `onOccluded` works per object, not per instance.
- **C093 Molecule Echo → C041** (mass-pitched plinks) and **C073**.
- **C095 Guess the Count → C082** as stage prompts, worded "inside the view" rather than "visible".
- **C096 Cleave the Crystal → C035** as its challenge mode.
- **C104 Lock Screen Maker → C105's** share sheet. Use designed compositions rather than random quaternions, seeded from the Remix code.
- **C107 Remix Chains → C062.** Emit VIEW_FORKED and store the parent code now; show family trees only once there is volume.
- **C112 Director Mode → C103** as phase 2. The one-tap reel uses designed templates, with captions taken only from measured facts.

### 2.3 Rework (promising but flawed; the fix is stated)

- **C007 Crisp Edges, Lighter Frames** · 3.4 · 3/3/5/3/3. Split: the art director champions it; the engineer and mobile judge ask for a rework. "Use alpha-to-coverage and drop MSAA" contradicts itself: in three 0.186.1, alpha-to-coverage is enabled only when `sampleCount > 1` (WebGPU) or `currentSamples > 0` (GL2). **Fix:** make analytic `fwidth` coverage an R3 acceptance criterion. Keep 4x MSAA with alpha-to-coverage on desktop, and use 2x with alpha-to-coverage, or SMAA, on phones. Measure on a 1M-atom Cu lattice mid-orbit. Revisit dropping MSAA only once TRAA is viable.
- **C020 Breathe, Dream, Then Sleep** · 3.6 · 4/4/4/3/3. Split over atom sway and the dream tour. **Fix:** camera- and light-only breathing for 2-3 s as an invitation, then C002 sleep. No dream tour on phones or under reduced motion, and a small startle on wake.
- **C024 Thumb Loupe and Lens Cursor** · 3.4 · 3/3/3/4/4. The engineer notes that the crop re-render repeats all vertex work at 1M+ atoms. **Fix:** magnify the already-rendered colour target around the finger, and make hold-slide-release the phone's precise select. Replace the radius swell with a light rim, because radii are data. Share long-press with tug through a movement threshold.
- **C033 Hold to Heat** · 3.6 · 4/4/4/3/3. The product steward says claiming "real thermal amplitudes" for illustrative jitter blurs the honesty line; the mobile judge flags flicker risk and an undiscoverable hold. **Fix:** lead with a slider (role=slider, kelvin), drop the bond flicker, and use an integer-hash jitter. Charge-and-release fires C030's burst, and an explicit hand-off goes to C072 ("see real copper melt").
- **C039 Gift-Wrap Gem** · 3.0 · 3/3/3/3/3. The shatter is a gimmick, OIT glass is costly, and the hull of a lattice is just a box. **Fix:** drop the shatter, use an opaque faceted material on phones, limit it to molecules under 50k atoms, and pair it with face and habit labels on C60 and diamond as observation-prompt toys.
- **C040 Lasso and Cookie-Cutter** · 3.4 · 4/4/3/3/3. The product steward says calling the cut shapes "real nanoparticles" overclaims. **Fix:** ship the lasso first. Save cutter output as "derived, unrelaxed, cut from an ideal lattice", with provenance. Preset stamps should work from the keyboard, and the press-down animation should reuse the condense tokens in reverse.
- **C054 Print Shop and Lens Skins** · 3.4 · 3/4/3/3/4. The art director calls it a grab-bag of stock filters; the engineer notes that Retro and Pixelation are separate PassNodes, so one `select()` can't switch them. **Fix:** three print-native skins (riso, halftone, blueprint) as prebuilt `compileAsync` graphs, swapped from a strip and tied to cards and posters. No animated grain under reduced motion.
- **C058 Worlds (sky, sunset, fireflies, underwater)** · 2.8 · 3/3/3/2/3. Dragging the sun regenerates the PMREM every frame, and `@pmndrs/sky` is unverified on GL2. **Fix:** fold it into C044, with the sun as the key light, PMREM regenerated on release, and one art-directed dusk. Salvage the fireflies into C050 and drop underwater.
- **C064 Fogged Lens You Can Wipe** · 3.0 · 3/4/3/2/3. The playtester scores it 4; the product steward calls it a Cryo-only novelty. **Fix:** make wipe-to-reveal a general mechanic (the Frost Reveal Daily with C088, or any new arrival). Run regrowth as a bounded low-fps job that ends in `onIdle`, and add a Wipe chip and a Clear button.
- **C068 Doodle to Particles** · 3.2 · 3/4/3/3/3. All five judges say the doodle never becomes a molecule. **Fix:** end by resolving the particles onto a real molecule of similar shape ("your doodle looks like benzene"), with a 2D fallback.
- **C069 Made-Of** · 3.2 · 2/4/4/4/2. Sharp split: the playtester, art director and product steward call it the strategic heart of `/scan`; the engineer and mobile judge see a chain of unverified pieces (GaussianSplat is WebGPU-only; `initFromDevice`; HF_TOKEN). **Fix:** re-home the existing particle cloud onto molecule positions with no splats. Label candidates "probably contains", make a no-token demo the default showcase, and land it with the C030 condensation.
- **C070 Atomize Me** · 3.4 · 4/4/3/2/4. The product steward would park it as off-mission and face-derived; three judges score it 4. **Fix:** label it "art made of atoms" and never save it as a structure view. Keep it private by default and on-device only, offer draw-or-emoji before the camera, and cap it at 5k atoms.
- **C074 Snap & Build** · 3.2 · 3/4/3/3/3. The product steward notes that PhET owns Build a Molecule; the playtester loves the speedrun. **Fix:** tap-tap builds of small molecules that resolve to a real gallery or PubChem entry, relaxed only on "done". Launch the speedrun from C030's burst as the one competitive hook.
- **C077 Atom Recycler** · 3.2 · 3/3/4/3/3. The product steward says flying atoms read as a reaction mechanism; the playtester finds it passive. **Fix:** label it "atom bookkeeping, not mechanism", cite a source per reaction, and start with 3-4 precomputed mappings on the v9 `uProgress` hook. Add discovery by dropping one molecule onto another.
- **C082 Powers of Ten** · 3.6 · 3/4/5/3/3. Sharp split: the art director champions it; the engineer asks for a rework, because six or more orders of magnitude need camera-relative positions and log depth, and the mobile judge calls one continuous pinch a vestibular stress test. **Fix:** discrete stages, each with its own near and far planes, joined by crossfaded handoffs, with a Next-scale button and keys. Frame it as a journey starting from water. It absorbs C095.
- **C114 Poster and Print Studio** · 3.0 · 3/2/4/3/3. The engineer notes that tiled renders leave seams in screen-space post at tile borders. **Fix:** render one large target up to `maxTextureDimension`, or tiles with guard bands. Start with the Illustrate look and one Swiss PDF layout, and offer capped-memory posters on phones.
- **C118 Molecule Reel** · 4.0 · 4/5/4/3/4. The playtester champions it; the product steward asks for a rework, because caffeine's atoms arcing into C60 implies a transformation that doesn't exist. **Fix:** a scatter-and-condense labelled "transition" on the C030 tokens, proven in the ordinary switcher first. Then build the feed with `overscroll-behavior: contain`, arrow keys, Save-Data-aware prefetch and toys on every card.

### 2.4 Parked (not now)

- **C011 Frames Without the Main-Thread Tax.** Real value for million-atom MD, but not for newcomers. Revisit when C072's melt runs need smooth scrubbing, and unwrap in the worker rather than the positionNode.
- **C012 Play Before It Loads.** An XL new file format, and interpolated MD spans are an honesty hazard: the art director warns of mushy motion on the very first Play.
- **C013 Visibility-Buffer Impostors.** The named contingency in case the R3 gate spike finds bad early-Z loss. For now, prototype only the ID+depth pass that C009 and C049 need anyway.
- **C032 Pick It Up and Toss It.** Per-atom XPBD squish is overkill and clashes with the specimen brand. Salvage the rigid bounce as a C021 easter egg.
- **C036 Twist the Ribbon.** It fits two gallery items and fights pinch-zoom. Revisit as a C027 deformer once two-pointer capture exists.
- **C037 Crystal Sand.** XL, [GPU]-only, with atomics. The art director calls it potentially the most breathtaking image in the set. Revisit after C028 ships and C014 has thermal data; see the moonshot direction.
- **C047 Hologram.** Sharp split: the art director kills it as a generic sci-fi trope that washes out element colour; the engineer and mobile judge score it 3. It is also a fill-rate bomb at 100k+ atoms. Keep it only as a cosmetic Remix rare roll or seasonal unlock, with no flicker.
- **C052 Gummy Molecule (melted jelly surface).** A separate mesh capped at about 80 atoms, relying on drei Caustics, which is unverified at runtime. It duplicates C051, and metaballs imply a surface that isn't a real SES.
- **C057 HDR Sparkle and Jewel Palettes.** HalfFloat bandwidth costs tile GPUs, and the reach is small. Revisit on desktop HDR monitors after C014.
- **C071 GPU Twins of math/noise.** Premature: TSL already ships `mx_noise`, and bit parity between CPU and GPU is impossible. Build only the kernels a shipped toy needs.
- **C075 VSEPR Balloons.** PhET's Molecule Shapes owns this. Salvage "compare the model with the real measured angle" into Learn.
- **C079 Phase Box.** The playtester scores it 4, the product steward 2: live MD drifts toward research execution, and PhET owns the argon box. C072's real runs cover the idea.
- **C081 Molecule Life.** Toy rules risk teaching wrong chemistry, most of it is GPU-only, and it is generic generative art.
- **C097 Sheepdog.** The playtester scores it 4, the art director and product steward 2. Cute, but a generic browser game.
- **C098 Polymer Snek.** A generic snake skin. Its FABRIK chain is reused inside C031.
- **C101 Scan Scavenger Hunt.** Gated on HF_TOKEN, needs a cost owner, and uploads photos over cellular. Revisit after C069 proves `/scan`.
- **C108 Shelves.** The teacher channel is real, but start with a shelf as a URL list of saved views, with no new storage.
- **C111 Room Window.** Pseudo-AR behind two permission prompts; C110 does AR better.
- **C115 Co-View Rooms.** XL Durable Objects infrastructure. Salvage a one-way "snap to teacher" broadcast and pass-and-play on one device.
- **C116 Atom Stop-Motion Studio.** Honest and charming, but slow to reward. Revisit after C074's snapping exists.
- **C117 The World's Crystal.** XL collective storage outside the contract's bounds. It needs an ownership decision and a proven C088 loop first.
- **C119 Molecule Doors.** Live portals re-render whole scenes, and MeshPortalMaterial is unverified. Salvage static "related" cards that FLIP into the viewer.

### 2.5 Killed

- **C018 Living Wall, One Canvas** · 1.4, 3 kills. Live canvases on `/` are disqualified, multi-canvas is absent on GL2, it is XL, and it would be the worst thermal load on the list. The only salvage, static thumbnails that FLIP, is already in C016.
- **C059 Electron Fuzz** · 1.8, 2 kills. Whatever the badge says, a soft cloud around atoms will be read as electron density. It is decoration posing as evidence.
- **C086 Lab-in-a-Tab (GFN2-xTB)** · 1.8. This is research execution in the browser, on a ~29 MB GPL wasm download, and "computed" labels promote viewer computation to evidence. Precompute offline instead, as C073 does.
- **C099 Periodic Pinball** · 2.0. An arcade skin with nothing molecular in it; the art director says it would look like an ad game. The one lesson, that DOM flippers get iOS haptics, goes to C041.
- **C100 Shake the Jar** · 2.0. C60 assembling itself from magnetic fragments teaches a wrong mechanism (the product steward's kill), and it is L effort on top of C042.
- **C102 Nanokart** · 1.8. XL, and first-person driving over bumpy surfaces is the biggest motion-sickness risk on the list (the mobile judge's kill). The probe-eye camera is salvaged into C113.

### 2.6 Sharpest judge splits

| Idea | High | Low | The tension |
|---|---|---|---|
| C069 Made-Of | P/A/Pr 4 | E/M 2 | The heart of `/scan`, but it rests on unverified splats and device sharing |
| C046 Depth Atmosphere | E/A 5 | P 2 | Nearly free cinematic depth, but invisible as play |
| C045 Film Stocks | A 5 | P 2 | Truthful tone mapping and identity, but a settings feature to players |
| C066 Matcap Bake | M 5 | P 2 | How looks reach phones, but invisible to players |
| C007 Crisp Edges | A 5 | E/M 3 (rework) | A visible "cheap renderer" tell, but the pitch contradicts itself |
| C082 Powers of Ten | A 5 | E/Pr/M 3 | The brand's scale moment, but precision and vestibular risk |
| C118 Molecule Reel | P 5 | Pr 3 (rework) | The 30-second loop, but arcing atoms imply a fake transformation |
| C002, C014 | E/Pr/M 5 | P/A 3 | Invisible foundations that everything depends on |
| C070 Atomize Me | E/P/M 4 | Pr 2 | A personal viral hook, but off-mission, with faces |
| C047 Hologram | E/M 3 | A 1 (kill) | Cheap, but a generic trope that erases element colour |
| C038 X-ray Box | E/A/Pr 4 | P 2 | A strong analysis tool, but "a feature with handles" |
| C094 Passport | P/M 4 | A 2 | A retention loop with no visual payoff |

---

## 3. Cross-cutting lessons

1. **One Play layer, closed-form.** C027's offset contract should be a registry of closed-form deformers `f(base, t, uniforms)` with CPU twins. A sparse stored buffer is used only for IK and tug. The picker, labels, bonds and trails evaluate the same function; export zeroes it; and evaluating at `t−dt` gives `positionPrevious` for free. C028's ripples, C029's wake, C030's burst, C033's heat and C035's knife all become fixed uniform slots in **one touch-field shader function** gated by `If()`, so each new toy is a CPU controller rather than a shader change.
2. **The mood bus and look space have real costs.** `select()` evaluates both branches, a pass at zero weight still costs full time, and changing the tone-mapping operator rebuilds the output node. The pattern: blend at most two looks with `If()` on uniforms, bake grades into LUTs, and swap prewarmed graphs for anything structural. Additive and OIT looks sit outside the continuous space.
3. **Motion tokens as the product's feel system.** C003's kernel should publish named springs (snap, glide, float, wobble, settle), a settle helper, and `motionScale` for reduced motion. The camera, DOM, toys and sound cues (C041) all draw from it, so every transition looks and sounds as if one hand authored it. C030's condensation becomes the signature "condense" motif, reused by search, scan, switching and embeds.
4. **Honesty as a design pattern, not a badge.** The illustrative chip is the Play control and the one-tap reset. Every illustrative toy has a real counterpart one tap away (C033 hands off to C072, C030 to C080, C028 to C073). Newly baked data carries a provenance manifest. Decoration must never look like evidence: C059, C100, the C118 arcs and the C033 amplitude claim were all penalised for this.
5. **Degrade ladders are designed, not inferred.** Every idea carries a backend tag and a stated GL2 behaviour. C004 only after C014 data. Low Power Mode is detected by cadence, not mistaken for slowness. Matcap LOD (C066 plus C056's pixel-radius LOD) serves phones and far atoms. Fog is the default for large scenes. `UnsignedByte` output on mobile.
6. **Demand frames are a contract.** Every toy declares a settle condition and a still key-frame. That one rule gives battery life (C002), reduced motion (one still per action), and sleep without a snap.
7. **One capture service.** A fixed-size render target, async readback, a raw post-free pass when transparency is needed, and the share sheet serve C103, C104, C105, C106, C060 and C114. Idle accumulation (C061) is the capture, so cards always look their best at no extra render cost.
8. **The ID buffer is a query engine.** C009's RGBA8-packed ID target also answers visibility (C092), hunt hints (C091), loupe snapping (C024) and Illustrate edges (C049). Read a finger-sized patch on touch.
9. **Ship v9 slices first, but never as GLSL the port discards.** That means `math/time` springs, scheduler 0.2.0, the `uProgress` hook, Quick Look wiring, Satori cards, the hsl bug fix and DOM games. It never means new `onBeforeCompile` work.

---

## 4. Gaps nobody covered, and the best sparks

**Gaps**

- **Interaction:** a gesture grammar per platform (phone, trackpad, keyboard, switch access, screen reader); toy discoverability without panels (affordances, a Play chip, a "secrets found" meter); a one-tap reset and safety net; the audio default (on after the first gesture with a visible mute, or opt-in); which molecule a stranger lands on first, since C60 bursts beautifully and a flat 24-atom molecule ripples poorly.
- **Accessibility:** a keyboard atom cursor and screen-reader narration of toy state; a flash guard for WCAG 2.3.1; a motion-sickness budget (the camera never moves without input); one shared sensor-permission flow with stand-ins; captions for sound cues; forced-colors, `prefers-contrast` and reduced-transparency support; colour-blind-safe palettes.
- **Measurement:** a stranger playtest protocol; PII-free delight events (time-to-first-rotate, first poke, share completed, Daily finished).
- **Engineering:** first-interactive-frame budget and pipeline prewarm; `GPUDevice` loss recovery; per-atom memory at 5M atoms; motion vectors for displaced atoms; a lazy toy registry and bundle budget; camera-relative rendering and log depth; a Save-Data and cellular policy; the old-iPhone double penalty (GL2 fallback plus Low Power Mode).
- **Art direction:** a house style spec (lighting rig, AO re-tune, backdrop); look-parity goldens through the port; bond visual design; 3D label typography; grounding and contact shadows; colour continuity between DOM chrome and the scene; designed loading, empty and error states.
- **Product:** indexable zero-canvas `/m/:id` pages (the sitemap has 7 URLs); toys that answer the 12 curated molecules' observation prompts; honest "lite" messaging for the ~13% on WebGL2; a publisher and manifest for baked science data; a classroom channel short of XL co-view; distribution through the Expo shell.
- **Play:** easter eggs and mastery; local pass-and-play multiplayer.

**Best sparks (carry into round 2)**

- **Free motion vectors** (engineer): closed-form deformers evaluated at `t−dt` give TRAA and motion blur for the fun layer.
- **One Touch Field Fn** (engineer): the deformer registry with fixed slots.
- **The ID buffer as a query engine** and **idle accumulation as capture** (engineer).
- **Matcap LOD** (engineer), and **a v9 fun slice with zero new GLSL** on `uProgress`.
- **Instant Replay** (playtester): a ring buffer of the last ~6 s of pose and mood values, re-rendered frame-exact for sharing.
- **Tap = Pluck, everywhere** (playtester): a real mode where one is baked, a ripple otherwise, and always a plink.
- **Charge and Release** (playtester): heat, then burst, then a "snap it back" speedrun.
- **Frost Reveal Daily**, **Spin to Unlock** and **Rare Rolls** (playtester).
- **The Condense motif** as logo-in-motion, **the Illustrate print voice**, the **Specimen Camera**, **Light Painter drives the sky**, and **Section View language** (art director).
- **Observation-prompt toys**, **zero-canvas `/m/:id` pages**, **the illustrative chip as the Play control**, **a real counterpart for every toy**, **Daily → loop → card**, and **"See it on your desk" deep links** (product steward).
- **The Play chip plus gesture grammar**, the **accessible atom cursor**, the **flash guard node**, the **Clear Look**, the **Low Power Mode sensor**, **one still per action**, and **motion-sensor stand-ins** (mobile judge).

---

## 5. Round-2 brief

Round 2 must go **beyond** round 1. Don't re-pitch champions. Combine them into flagship experiences, fix the reworks under the judges' stated conditions, fill the gaps above, and push further on phone-native play, non-science joy and moonshots. Every idea must state: its backend tag and WebGL2-fallback behaviour; the R# it rides or its v9 slice; that it stays outside deterministic export; its reduced-motion still; its keyboard equivalent; and a phone budget with no FPS claims. Disqualified: live canvases on `/`, and motion that moves source atoms.

### D1 `first-minute-flagship`: The First Minute, Choreographed End to End

Design one continuous flagship experience, from a stranger landing on `/` to their first share, that stitches round-1 champions into a single authored sequence instead of separate features. Build from:
- C015: an SVG pocket molecule on `/`.
- C016: intent prefetch, and the tile that becomes the molecule.
- C030: condensation as the house arrival.
- C021: flick, coast and detents, which already absorbs C022 and C023.
- C028 with C073: Tap = Pluck (the real mode where one is baked, a crisp ripple elsewhere).
- C041: cues fired from spring events.
- C019, reworked as an abstract touch mark.
- Instant Replay on C103: the last ~6 s re-rendered frame-exact.

Deliverables:
- The first molecule a stranger lands on, justified by playability.
- A storyboard of seconds 0-60 on a phone and on a trackpad, naming the exact gesture for each beat.
- The art-directed match frame from SVG to 3D: identical pose, palette, scale and light.
- A split between what ships on v9 (prefetch, the SVG hero, flick, the `uProgress` condensation, the v9 loop export) and what ships after R3.
- The PII-free activation and delight events to instrument (time-to-first-rotate, first poke, first share).

Constraints:
- Zero canvases on `/`, and an owner call on home motion: start still, move only on touch.
- The entrance plays on the first open per session only, can be cancelled, and runs under 600 ms.
- The reduced-motion path is designed stills and crossfades, not "skip".

Pitch the seams, the sequencing and the moments between the components, not the components themselves.

### D2 `play-for-everyone`: One Gesture Grammar, Findable Toys, Play for Everyone

Every judge flagged the gesture conflicts, nothing makes toys discoverable, and only 2 of 180 ideas mention screen readers. Produce the conflict-free interaction system.
- **Gesture maps** for phone, trackpad and mouse, keyboard, switch access and screen reader. They must respect OS conventions: double-tap-and-slide zoom, the iOS edge back-swipe, pull-to-refresh, and the `touch-action` and `overscroll-behavior` properties.
- **The Play chip:** one-finger drag always orbits, and a chip in the thumb zone swaps the one-finger verb.
- **The Play control:** the "illustrative motion" chip is also the Play control and a one-tap reset (C027).
- **The accessible atom cursor:** roving focus over atoms through SpatialHash, announced as "Oxygen 3, bonded to C2 and H7". Enter pokes, P plucks and Shift+arrows tug.
- **Discovery without panels:** first-touch surprises, and a "secrets found" meter.
- **Sensors:** one shared permission flow with a visible "sensors on" indicator, and a button or key for every shake or tilt.
- **Safety:** a flash-guard node in the output pass (WCAG 2.3.1), and a camera motion-sickness budget.
- **Reduced motion:** a per-toy "one still per action" contract.
- **A playtest protocol** for watching strangers on couch phones and trackpads.

For each rule, cite which contested round-1 idea it resolves: C009's wheel, C023, C024, C030, C031, C033, C035, C040 or C064. Add new toys only where they fill a hole in the grammar.

### D3 `port-as-toy-engine`: The v10 Port as a Toy Engine, with Milestones That Ship Joy

Turn R1-R12 into a delivery plan in which every milestone ends in something a visitor can feel, and close the engineering gaps round 1 skipped. Build on C001 (scoped hooks), C027, C009, C048, C002 and C003. Don't restate them. Pitch:
1. **The v9 fun slice with zero new GLSL.** Ship the condensation, the switch morph and the recycler on the existing `uProgress` hook during Phase 0.
2. **Free motion vectors.** Evaluate each deformer again at `t−dt` to emit `positionPrevious`.
3. **One Touch Field function.** Fixed uniform slots, gated by `If()`.
4. **A first-interactive-frame budget.** A pipeline cache plus a `compileAsync` prewarm for impostor variants and look graphs (#33821).
5. **Recovery from `GPUDevice` loss.** Restore state across the viewer, gist, bonds and Studio.
6. **A byte budget per atom at 5M atoms.** Half-float offsets, with sparse storage only for IK.
7. **A lazy toy registry.** Each toy gets a bundle budget, so 30 toys don't bloat the ~1 MB viewer chunk.
8. **A phone gate spike.** Test iOS 17/18 on GL2, Low Power Mode and a mid-range Android, with the poke and burst as the parity-exit acceptance tests.
9. **Camera-relative rendering and log depth** for deep zooms.

Each pitch names its R#, backend tag and GL2 behaviour, and a test in the R11 dual lanes.

### D4 `capture-share-loops`: Capture Once, Share Everywhere

Round 1 produced eight share ideas (C103, C104, C105, C106, C109, C110, C112, C114) that duplicate the same capture plumbing.

**The capture service.** Design one service:
- a fixed-size render target with async readback;
- a raw, post-free transparent pass when transparency is needed;
- encoding through Mediabunny or WebCodecs, with MediaRecorder as the fallback;
- output through Web Share or `ClipboardItem`.

**The loops on top of it.**
- **Instant Replay:** share what I just did.
- **The Daily:** a spoiler-free 3 s loop and a silhouette card (C088 + C103 + C106).
- **The Specimen Camera:** a shutter whose idle-accumulated frame becomes the card (C060 + C061).
- **"See it on your desk":** Quick Look deep links from cards (C110).
- **Remix codes** in every link (C062).
- **Tap-to-wake embeds** (C109).
- **Zero-canvas `/m/:id` pages:** SEO landing pages and unfurl targets at once. The sitemap has 7 URLs today.

**Timing.** Specify which parts ship on v9: Satori edge cards from saved-view coordinates, the v9 loop export and the Quick Look wiring. Specify which wait for R9.

**Constraints.**
- Every output is labelled illustrative and is never an MCP artifact.
- Generate alt text and captions from the name, formula and look.
- No new storage without a cost owner.
- VideoFrame from a WebGPU canvas on Safari is unverified, so specify the readback fallback.
- Use designed Illustrate templates, not random compositions.

Pitch the service, the loops between the formats and the share metrics, not the formats themselves.

### D5 `real-twins-science`: Every Toy Has a Real Twin

Turn the honesty contract into the curriculum.

1. **A real counterpart one tap from every illustrative toy.** Reworked heat (C033) hands off to C072's `cu_melt` thermometer. The burst (C030) hands off to `sand_w_cascade` (C080), the poke (C028) to a baked normal mode (C073), and the knife (C035) to real crystal planes. Growth (C078) ends on the real crystal.
2. **One bespoke toy per curated molecule.** Each of the 12 curated student molecules gets a toy that answers its existing observation prompt:
   - benzene: the knife shows the flat ring;
   - C60: the hull shows the icosahedron;
   - water: sticky-water tug;
   - diamond: the X-ray box counts atoms per cell.
3. **A provenance pipeline for newly baked data** (modes, collision runs, reaction mappings): who publishes it, the manifest format, and how Learn displays it.
4. **Fixed science reworks,** under each judge's stated conditions:
   - C077 as "atom bookkeeping, not mechanism";
   - C074 as tap-tap builds that resolve to real entries;
   - C040's cutter output labelled "derived, unrelaxed";
   - C082 as a staged journey that starts from water;
   - C039 without the shatter.

Constraints:
- No live MD and no in-browser quantum chemistry: C079 was parked and C086 killed as research execution.
- Decoration must never look like evidence (C059, C100).
- Say "illustrative" in words, not only with badges, and give every result as accessible text.
- No new standalone arcade games.

### D6 `pocket-native-play`: Pocket Play, Built for a Phone in One Hand

Go deeper than "tap and flick" for commute, couch and queue moments. Design:
- **Reach and layout:** one-thumb reach zones, and layouts that ride the sheet (C026).
- **A finger-accurate select:** the reworked C024 loupe, magnifying the frame that is already rendered.
- **Sensors:** shake and tilt through the shared permission flow, with button stand-ins.
- **Local play:** pass-and-play on one phone (hide an atom, hand the phone over).
- **Orientation:** sideways as a toy mode.
- **The old-iPhone double penalty:** iOS 17/18 on the GL2 fallback in Low Power Mode at 30 fps. Detect a locked 33.3 ms cadence and offer still-frame toys instead of degraded continuous ones.
- **Data cost:** Save-Data and cellular caps for the ~1.2 MB of viewer and WebGPU chunks, trajectory streams and openchemlib.
- **Memory:** limits that avoid iOS tab kills.
- **The Expo shell** as a channel: expo-haptics, the native share sheet and store presence.

Haptics: since iOS 26.5, web haptics fire only from direct taps on a DOM switch. Design DOM-tap haptic moments (detent chips, flipper-style buttons), not ticks tied to drags.

Build on C021, C026, C028, C041, C042/C043, C067 and C110 without repeating their core pitches.

Constraints:
- Battery first: demand frames, per-job fps, settle then sleep.
- Sensor permission only from an explicit gesture.
- Every pitch names its GL2 and Low Power Mode behaviour.
- No FPS claims.

### D7 `joy-and-mastery`: Pure Joy, with Collectibles, Mastery and Secrets

Round 1's non-science fun was mostly arcade games with no molecule in them (C097, C098, C099 and C102 scored lowest) or one-note gags. Design joy that comes from the molecule as an object and from play itself, with no lesson required:
- **Mastery and easter eggs:** spin records, perfect detent chains, secret gestures.
- **Collectibles earned by play, not menus:** Spin to Unlock; Rare Rolls on C062, with holo or gold codes and their own chime; a toy passport, alongside C094, that stamps discovered verbs.
- **Discovery:** a "secrets found" meter.
- **Idle hands:** desk-toy and fidget modes.
- **Sound:** ASMR-grade sound design on C041.
- **Seasonal and daily twists** on existing toys.
- **Brag moments** that are spoiler-free and free of PII.
- **Character:** give elements personality (salvaged from C083) without cartoon physics that distorts the specimen. The art director penalised squish, tilt sag and party hue-cycling.

Constraints:
- No money-backed gacha, no dark patterns, no streak shaming.
- No flashes above 3 Hz.
- Every unlock is reachable by keyboard.
- Use localStorage unless storage has a cost owner.
- Cosmetic unlocks never look like data: C047 returns only as a clearly cosmetic rare roll.

Each idea must be something only a real 3D molecule can do, not a game skin that fits any subject.

### D8 `signature-and-moonshots`: Lupi's Signature Look, and Moonshots Past the Gate Spike

This direction has two linked halves.

**(A) The house style round 1 never wrote.** A spec that unifies the landing, viewer, scan, cards and posters. It covers:
- the canonical lighting rig and backdrop, and an AO re-tune now that the N8AO look is lost;
- Illustrate (C049) as the out-of-app print voice, and the Condense motif (C030) as logo-in-motion, both on C003's motion tokens;
- bond design (split colour, thickness by bond order, strain colour);
- 3D label typography for the R8 glyph shim;
- contact shadows that ground small molecules;
- colour continuity between the DOM chrome and the backdrop;
- designed loading, empty and error states;
- a colour-blind-safe, high-contrast "Clear" Look (C045 + C063 + C056 + C049);
- look-parity goldens for each look, backend and quality rung.

**(B) Three or four real moonshots** that show off that signature on flagship hardware. Each is gated by the gate spike and C014 data and states its degrade path. Candidates:
- Crystal Sand as a single-crystal hero (C037);
- a path-traced gallery print on WebGPU desktops (C061, tier 2);
- Powers of Ten done right (reworked C082);
- the `/scan` Made-Of dissolve (reworked C069);
- Light Painter driving `@pmndrs/sky` (C044 + C058).

Moonshots must name their [GPU] tier and the phone and GL2 experience, keep the honesty contract, and justify their cost for casual visitors. Don't add Looks to the catalogue: aim for fewer, better, recognisable ones.
