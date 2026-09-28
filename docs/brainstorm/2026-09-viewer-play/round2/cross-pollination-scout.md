# Round 2 · Cross-Pollination Scout: fresh outside mechanisms

[← all round-2 ideas](README.md)

## Direction notes

RESEARCH (about 33 lookups: WebSearch and WebFetch, plus local verification of three 0.186.1 sources)

Mechanisms I drew on, which round 1 did not use:
- Music and toys: Chrome Music Lab (Kandinsky scan line, Voice Spinner), NASA/Chandra sonification (radar sweep; blind users were the most engaged), Patatap, Rez quantization, Blob Opera.
- Collectibles and product imagery: pokemon-cards-css holo cards, e-commerce 360° sprite spinners.
- Materials: Apple Liquid Glass lensing and the HIG layer rule, plus the Codrops 2026-09-08 TSL liquid-glass grid (SDF heightfield → refract() taps with per-channel IOR).
- Game feel: Vlambeer's screenshake talk (hit-stop, permanence), Eiserloh's trauma² noise shake.
- Status UI: Dynamic Island React implementations.
- Toys: Townscaper and Tiny Glade (toy, not game), Toca Boca, pop-it fidget apps.
- Museums: statue rubbing and polished bronze (Porcellino), Exploratorium APE, Chladni plates.
- Photography: star-trail lighten stacking.
- Physics and chemistry: the tennis-racket theorem, the CNT (n,m) rule, Wulff construction (ASE), point-group detection (Symmetrizer/WebMO).
- Editing: the JKL shuttle.
- Also read: Bruno Simon's folio (whispers, achievements), Infinite Craft's First Discovery, and Codrops' procedural-geometry 'never allocate on a slider' rule.

Verified locally:
- three 0.186.1 AfterImageNode is literally max(texelNew, texelOld·damp·mask), i.e. lighten stacking, and damp is a node, so it can be a uniform. This is what the Star-Trail idea rests on.
- pmndrs math has quat.exp but no eigen solver, so Weightless and Pop-It need a hand-written Jacobi.
- /collectAnalytics only console.logs, so global patina needs new storage and a cost owner.
- v9 has a per-atom 'property' colour mode, which gives Chladni an honest v9 slice.
- Free keys: j, k, l, f, i, h, m are unclaimed; v, x, b, t and 1-7 are taken.
- cnt_6_6 is exactly 4 unit cells, which makes it the golden test for the generator.

DESIGN RULES I held to
- Every idea translates an outside mechanism into something only a real 3D structure can do, and carries a real twin or real computation. Real inertia tensor, real (n,m) geometry and metal rule, real symmetry elements, real mode amplitudes, real frames with a measured activity waveform, and real renders on the cards. There are no arcade skins.
- Gesture conflicts are resolved by making each new verb a Play-chip mode with mode-scoped keys. The default tap stays C028/C073's Pluck and ripple. D2 must ratify long-press ownership (lens, hang, remove).
- Honesty is structural. Status Island makes illustrative motion and sensors impossible to run without their words visible and a one-tap reset, which turns the C027 badge into a guarantee.
- Every idea has a v9 slice with zero new GLSL, or says 'record-only' (Worn Bright), or 'honest core only' (Chladni via the property colour map). The v9 slices reuse the existing uProgress mix (Pop-It), CPU uploads for sheets of 1k atoms or fewer (Roll), a 2D lighten accumulator on preserveDrawingBuffer (Star-Trail), and DOM (Cards, Island, Deck, Juice, Music).

TENSIONS I RESOLVED
- C015's art-director critique ('SVG circles look like clip art') versus zero canvases on `/`: Holo Cards bake real-renderer turntables into sprite strips. That keeps `/` canvas-free and solves D1's match frame by construction. Bytes are handled by intent loading, a preview strip first, and Save-Data.
- Screen-shake appeal versus the vestibular risk: the Juice Pass ships with a hard budget and 'Calm camera', is zeroed under reduced motion, and never shakes while a finger is down.
- C024's re-render cost: the Droplet Lens samples the already-rendered pass texture through an overlay quad, and adds a rim instead of a radius swell.
- Sound default: Music Box is opt-in by entering the mode, which is a gesture, so the default question doesn't block it. Its sonification also gives screen-reader users a real channel.
- Symmetry exactness: Kaleidoscope forces an orthographic camera and scores the seam from 3D operations (including perpendicular C2 axes, which project as mirror lines), not from pixels.

DELIBERATELY LEFT OUT
- Infinite Craft-style AI combination and global First Discovery: needs an LLM and storage, and risks inventing chemistry.
- Bruno Simon's public 'whispers': moderation.
- Blob Opera ML harmonisation: model weight and a fidelity risk.
- An anaglyph and red-cyan 3D easter egg: AnaglyphPassNode exists in r186, but it is another Look and D8 asks for fewer.
- A ZIF-8 molecular-sieve shape sorter: needs curated kinetic-diameter data.
- A Chrome-Dino-style offline toy, Katamari aggregation, a Newton's-cradle desk toy.

SYNERGIES
- Weightless feeds Star-Trail rosettes and the Music Box melody.
- Kaleidoscope axes and Roll (n,m) results stamp the Passport and unlock holo cards.
- Pop-It and Worn Bright share Vlambeer's 'permanence'.
- Juice, Status Island and the C041 bus are the shared substrate every other idea plugs into.

No FPS claims are made anywhere, and every phone budget is stated as bounded work followed by sleep.

<a id="r2-cross-pollination-scout-01"></a>
## Music Box Molecule: hear its shape, and play its elements like pads
`R2-cross-pollination-scout-01` · science-toy · effort M · judges mean **3.8** (E4 P5 A3 Pr3 M4; champion 1, keep 2, merge 2) · self-scored fun 5 / visual 3 · perf neutral

> A thin brass comb line sits on the canvas. Spin the molecule and every atom that sweeps past the comb plucks a pentatonic note, so benzene plays one phrase six times per turn and C60 sings like a round. A strip of formula pads (C×8, H×10, N×4, O×2) turns the molecule into a Patatap-style instrument you can play by keyboard or thumb.

**Framing:** problem->solution

**Builds on:** C041+C021+C050+C093 (replaces the Simon framing with structure-as-melody and answers C041's 'nobody turns sound on')

**Problem:** Round 1's sound work (C041) is a generic cue vocabulary, and the judges noted it leaves most players in silence: sound is opt-in, and nothing gives a reason to turn it on. Rotating a molecule tells a screen-reader user nothing, and the organising idea of structure (repetition and symmetry) is invisible to newcomers. C093 (a Simon game) was folded away and C050 lights an element only as an inspection tool.

**Solution:**

Mechanism sources: the scan line in Chrome Music Lab's Kandinsky (https://musiclab.chromeexperiments.com/Kandinsky); NASA/Chandra's radar-sweep sonifications, where distance from the centre maps to pitch and blind and low-vision listeners were the most engaged group (https://chandra.si.edu/sound/, https://www.perkins.org/resource/sonification-chandra-and-hubble-space-images/); the music-box cylinder and comb; Rez's rule that player actions are quantized to the beat (https://en.wikipedia.org/wiki/Rez_(video_game)); and Patatap's 'every key is a sound plus an animation' (https://patatap.com/, https://github.com/jonobr1/Patatap).

Beats:
1. The 'Music' verb on the Play chip, or the M key while the canvas has focus, draws a comb: a vertical hairline with teeth at about 62% of the canvas width, in camera space. The Play chip swaps the one-finger verb, and it is only one entry point.
2. Spin it (C021 flick, drag, or the arrow keys). Each frame the CPU finds atoms whose camera-space x crossed the comb while in front (z>0).
   - Pitch is the atom's coordinate along the current spin axis, which is the music-box rule that a pin's position along the cylinder picks the tooth. It is quantized to a 2-octave major pentatonic scale, so no note is ever wrong.
   - Timbre follows the element family: H a glass chime, C a soft marimba, N and O a vibraphone, halogens a pluck, metals a bell.
   - Depth sets volume.
   - Spin speed is the tempo. A slow drag cranks the music box note by note; a flick plays an arpeggio.
   - Crossings snap to a 1/16 grid at a tempo derived from angular speed, so dense passages become rhythm rather than noise (Rez).
3. The crossing atom flashes for 120 ms (R2 flag byte; no flashes above 3 Hz per atom).
4. 'Hear it once' plays exactly one revolution at a fixed tempo about the current view's vertical axis. A caption reports what the melody reveals, computed from the autocorrelation of the note sequence within a pitch and timing tolerance, for example: 'This phrase repeats 6 times per turn: a 6-fold axis points along the spin.' The caption appears only when the repeat is exact within tolerance; otherwise it reads 'no repeat on this axis'.
5. Element pads, a DOM strip in the thumb zone built from the formula:
   - Tap C: every carbon pulses (emissive, not radius, because radii are data) and plays one plink per carbon in quick rhythm, so 8 carbons sound as 8 notes. The count becomes audible.
   - Hold a pad: the other elements ghost for as long as you hold, then return. It is a reversible peek and changes no settings.
   - Double-tap a pad: stamp the element into the Passport (C094).
6. Keyboard in Music mode: letter keys are pads, and two-letter symbols are typed within 250 ms (C then l = Cl). Typing the formula plays the molecule's 'name tune'. Letters that collide with global shortcuts (b, v, t, x) are claimed only while the canvas has focus in Music mode; boron and vanadium are also on the pad strip.
7. Share: 'Save the song' renders a frame-exact 4 s loop with audio. OfflineAudioContext renders the same crossing schedule, and Mediabunny muxes it (C103 capture service).

Performance rules:
- Up to ~20k atoms: test every atom each frame with math vec3.transformQuat into scratch tuples.
- Above that: query only a thin slab around the comb through SpatialHash and cap it at 256 candidates per frame.
- Audio: C041's 8-voice cap and 30 ms rate limit.
- Scheduling: the Web Audio lookahead scheduler ('a tale of two clocks', https://web.dev/articles/audio-scheduling), so notes land on time even when frames drop.

**Experience:**

Desktop: choose Music and drag slowly to hear notes one by one, or flick for an arpeggio; the comb glints on each note. Phone:
- Thumb flick to spin.
- The pad strip sits above the deck. Pads are real DOM buttons, so Android vibrate works, and iOS 26.5 switch haptics fire only if a direct tap on the pad's hidden switch counts (unverified; needs a device test).
- The iOS ringer switch mutes Web Audio, so a 'sound is muted by your ringer' hint shows once.

Keyboard:
- M toggles Music.
- Left and Right step the rotation by 1/24 turn and play that slice.
- Enter plays 'Hear it once'.
- Letters are pads.

Screen reader: the melody itself is the non-visual channel. aria-live announces 'Benzene, 6-fold repeat around this axis' and 'Carbon: 8 atoms'.

Reduced motion: no auto-spin. 'Hear it once' plays the audio over a single still frame with the comb drawn, one still per action. Sound follows the C041 default decision, with a visible mute.

**Tech:**

- Web Audio: one shared AudioContext created in a pointer handler, OscillatorNode or ZzFX voices, and lookahead scheduling (https://web.dev/articles/audio-scheduling). OfflineAudioContext for clips, plus Mediabunny.
- math@0.1.0: quat and vec3.transformQuat into scratch tuples.
- Scheduling: @pmndrs/scheduler job in the 'update' phase, invalidating only while spinning.
- Spatial queries: SpatialHash slab queries (packages/scene).
- Flash: R2 unorm8x4 4th-byte flag. On v9, pads pulse through a per-element palette texture upload (~1 KB), with no GLSL.
- Inspiration: Kandinsky, Chandra sonification, Patatap, Rez (links in solution).

**Backend:** DOM/CPU (audio and crossings); per-atom flash [GPU+GL2]

**Rides (v10 requirements):** none for the core (renderer-agnostic); R2 flag byte for the per-atom flash; R7 scheduler; rides C041's bus and C021's flick

**v9 slice:**

Everything except the per-atom flash:
- the comb as a DOM overlay;
- CPU crossings and Web Audio;
- element pads that pulse whole elements via a palette-texture upload;
- 'Hear it once' with the autocorrelation caption.

No new GLSL.

**WebGL2 fallback:** Identical: crossings and audio are CPU, and the flash byte is read by the TSL impostor on both backends. Low Power Mode: audio timing is unaffected because it runs on the audio clock; visuals may tick at 30 Hz.

**Where in code:**

- New packages/ui/src/play/musicBox.ts (crossings, quantizer, autocorrelation).
- packages/ui/src/lib/clickSound.ts grows into lib/sound/bus.ts, one AudioContext shared with C041.
- packages/ui/src/app/useGlobalShortcuts.ts: mode-scoped letter routing when the canvas is focused.
- packages/ui/src/coloring/colorSchemes.ts palette path for the element pulse.
- packages/scene/src/SpatialHash.ts slab query.
- Comb overlay beside packages/ui/src/app/ViewerScene.tsx.

**Risks:**

- Sound default: the playtester wants it on and the steward wants it opt-in. This toy is opt-in by definition, but Music mode can start audio because entering it is a user gesture.
- The iOS silent switch mutes it.
- Large lattices produce texture, not melody; cap it and say so.
- Letter-key collisions with v, x, b and t; mode-scoping needs the D2 grammar owner's sign-off.
- The repeat caption must not overclaim: it describes the repeat around the spin axis, not the point group. Kaleidoscope is the right tool for that.

**Honesty:** The mode is labelled 'Sonification of shape: pitch follows height along the spin axis, timbre follows element family. Not a spectrum or a vibration.' The real vibrational chord is Pluck (C073), one tap away. Counts and repeat captions are computed from coordinates within a stated tolerance. Nothing moves the atoms, and export is untouched.

**Judges:**

- E 4/merge: Merge into R2-joy-and-mastery-05. It is the same comb-crossing music box; its formula pads and the rule of quantising to the beat are good additions. *Improve:* Add the pads as a joy-05 mode that pulses elements through a palette upload.
- P 5/champion: Spin the molecule and it plays its shape; tap the formula pads and it becomes a Patatap instrument. Instant, audible and visible, repeatable, and shareable as a clip. Risks: muted iPhones and the unsettled sound default. *Improve:* Absorb joy-05 (axis choice, element timbres). Flash atoms visibly as they cross the comb so the toy works muted, and export 6 s of audio and video through Instant Replay.
- A 3/merge: Host: R2-joy-and-mastery-05. It is the same comb-line music box; the element pads are its only addition. *Improve:* Merge the pads into joy-05's Music Box as a second mode.
- Pr 3/keep: Sonification with accessibility evidence behind it (Chandra), opt-in by design. It hosts joy-05. *Improve:* Launch it after the sound default is settled.
- M 4/keep: Host for JM-05. Opt-in by entering Music mode, keyboard letter pads, and a sonification approach with an accessibility pedigree. *Improve:* Adopt JM-05's reduced-motion playhead and tempo caps, and keep flashes at 3 Hz or less per region, not just per atom.

<a id="r2-cross-pollination-scout-02"></a>
## Pop-It Shell: press atoms through, flip the sheet, press them back
`R2-cross-pollination-scout-02` · toy · effort M · judges mean **3.0** (E3 P5 A3 Pr1 M3; champion 1, keep 3, kill 1) · self-scored fun 5 / visual 4 · perf neutral

> A fidget pop-it made of a real structure. In Pop mode, tapping a graphene atom pushes it through the sheet with a soft thock. Flip the sheet over and every atom you pressed now bulges toward you, ready to press back. On C60 and nanotubes, dimple every atom and the cage springs back to shape.

**Framing:** problem->solution

**Builds on:** C028+C027+C003 (new persistent-toggle verb rather than transient ripple); share via C062/C105

**Problem:** Every round-1 touch toy is transient: ripples fade, bursts reassemble, tugs spring home. Nothing you do stays, which is what Vlambeer's 'permanence' lesson says makes action feel meaningful. Fidget apps (Pop It Fidget, Poppl) prove the loop of press everything, flip, and start again keeps idle hands busy for minutes. Lupi's most object-like structures (C60, cnt_6_6, graphene_ribbon, diamond surfaces) are the ones where tapping does least today.

**Solution:**

Mechanism sources:
- The pop-it board, and digital versions that tune each row like an instrument (https://apps.apple.com/ca/app/pop-it-fidget-asmr-board/id6799578042, https://apps.apple.com/us/app/poppl-fidget-focus/id6782650380).
- Vlambeer's permanence and 'sleep' (https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/).

Rules:
1. Pop is a Play-chip verb. The default tap stays C028/C073's Pluck and ripple (the round-1 grammar), so Pop never steals the default tap.
2. Normals are computed once per structure:
   - cage: the vector from the centroid;
   - tube: radial from the principal axis (math-free PCA of positions);
   - sheet: the PCA normal of each atom's 6-12 neighbours from SpatialHash.
3. On a sheet, tapping an atom moves its display offset to −n̂·d (d = 0.35 Å, about a quarter of a carbon radius) on the underdamped 'boing' motion token. It stays there (permanence). Tapping a pressed atom does nothing from this side.
4. Flip (F, a Flip chip, or a flick past 180°): the camera swings to the back. The pressed atoms now bulge toward you, so each tap pushes one back (+n̂·d → 0). Pressing every bubble on one side, flipping and pressing again is the whole pop-it loop.
5. On cages and tubes, tap dimples an atom inward. With every atom dimpled the shell reads as 'squeezed'; one more tap, or a shake stand-in button, re-inflates everything with anticipation and hit-stop (Juice Pass) and a chord.
6. Rows are tuned: pitch follows the atom's band (sheet row index, or latitude band on a cage relative to the view), pentatonic, so running a thumb along a row plays a scale.
7. Patterns: popped atoms form a 1-bit mask over atom indices, encoded in the URL next to C062's Remix code. C60 needs 60 bits (10 base64url chars); the 112-atom ribbon needs 19 chars. That makes 'I wrote LUPI on graphene' a link and a sticker (C105).
8. Deformer contract (C027): offset = n̂·d·state(t), closed-form. Settled atoms read one popped bit (R2 flag byte). Only the 8 most recent pops animate, through 8 fixed uniform slots {atomIndex, t0, direction}, the same slot pattern as C028's ripples. A CPU twin evaluates the same function for the picker and labels, and bonds follow through R4's atom-pair attribute.

**Experience:**

Desktop: click atoms in Pop mode; F flips; the counter shows 'popped 23/112'. Phone: tap with the thumb, and the Flip chip sits in the thumb zone. Canvas taps can't fire iOS haptics, so iPhone gets sound only; Android gets navigator.vibrate(8) per pop, and the Flip chip is a DOM button, so it can carry the switch-haptic trick where that works.

Keyboard: the atom cursor from D2 moves over atoms, Enter or Space pops, F flips, and Shift+R resets.

Screen reader: 'Carbon 14 pressed through. 23 of 112 pressed. Flip to press them back.'

Reduced motion: each pop appears as one still, with no spring, and Flip is a crossfade between two stills.

Battery: each pop wakes the loop for about 400 ms of spring, then it sleeps; nothing animates at rest.

**Tech:**

- Closed-form positionNode deformer in the R3 TSL impostor (base + offset), with 8 animating slots as uniforms (configureTSL/useUniforms, @react-three/tsl canary).
- Popped bit in the R2 unorm8x4 flag byte.
- R4 bond pairs so bonds follow.
- math@0.1.0 spring.update for the CPU twin; mulberry32 is not needed.
- Neighbour PCA with a hand-written 3x3 covariance: math has no eigen solver, so a ~40-line Jacobi routine is needed.
- Bitset codec in packages/core beside the C062 codec.
- Web Audio thock on the C041 bus.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (offset deformer), R4 (bond pairs), R2 (flag byte); C027 contract

**v9 slice:** For single-frame files up to about 5k atoms: on each pop, write the current display positions into instancePosition and the new state into instanceTargetPosition, then drive the existing uProgress uniform 0→1 on a math spring. AtomsOptimized.tsx and Bonds.tsx already mix by uProgress, so bonds follow with no new GLSL. Pattern codes and sound also ship on v9.

**WebGL2 fallback:** Identical. The deformer is closed-form math in the positionNode, and needs no compute or atomics. Low Power Mode: springs settle in the same wall-clock time at 30 Hz, because the analytic spring is used.

**Where in code:**

- New packages/ui/src/play/popIt.ts.
- v9: packages/scene/src/AtomsOptimized.tsx (the uProgress mix at ~line 367) and packages/scene/src/Bonds.tsx.
- Normals from packages/scene/src/SpatialHash.ts.
- Codec in packages/core/src/ with Remix codes.
- Chips in the Play chip and gesture-grammar module (D2).

**Risks:**

- Visible bond strain could be read as chemistry; keep d small and use the label.
- On v9, uProgress ownership conflicts with trajectory playback, so the slice is limited to single-frame files.
- Sheet normals are noisy at ribbon edges; clamp them.
- Tap ownership needs the Play-chip mode that D2 must ratify.
- iPhone users get no haptics on canvas taps.

**Honesty:** The chip reads 'Illustrative dents: display only. Coordinates unchanged; export ignores them. Reset restores.' The pattern code is a display state, never a structure, and cannot be saved as coordinates.

**Judges:**

- E 3/keep: A popped bit plus a closed-form dimple along a per-atom normal (sheet normal or radial) fits the flag byte and Touch Field. The v9 slice rewrites positions per pop up to ~5k atoms. Bit contention and uProgress contention with trajectories apply. *Improve:* Implement it as a persistent Touch Field kind with a bit allocated in port-05's table. Limit it to single-frame files.
- P 5/champion: A pop-it made of graphene or C60: press through, flip the sheet, press back, with rows tuned as scales, and 'I wrote LUPI on graphene' becomes a link. Tactile, permanent and ASMR, and the flip is something only a 3D object can do. It needs R3, the v9 slice is limited, and iPhone gets no canvas haptics. *Improve:* Ship the v9 slice on C60 and the ribbon, make the Flip a DOM button for the iOS haptic, and design a strong sound for each pop.
- A 3/keep: Tactile and fun on graphene, but a dimpled sheet looks like bubble wrap, and visible strain may read as chemistry. *Improve:* Keep the dimple depth small with no strain colour, so the popped state shows only through the offset and Contact AO.
- Pr 1/kill: A persistent, shareable deformation of a real structure: popped graphene looks like a buckled or defected sheet. That is decoration posing as structure, and a fidget orphaned from the product. *Improve:* Salvage the thock and the sense of permanence into the transient ripple.
- M 3/keep: Tap-only toggles are motor-friendly and persistent. *Improve:* Pop at the atom cursor by key, and make state changes instant under reduced motion.

<a id="r2-cross-pollination-scout-03"></a>
## Weightless: spin a molecule on its own real inertia (and hang it by an atom)
`R2-cross-pollination-scout-03` · science-toy · effort M · judges mean **3.6** (E4 P4 A3 Pr4 M3; merge 5) · self-scored fun 5 / visual 3 · perf neutral

> Flick a molecule in Weightless mode and it tumbles the way that exact mass distribution tumbles in space. C60 spins like a ball and benzene precesses like a coin. Caffeine spun near its middle axis flips over again and again (the Dzhanibekov effect). Long-press an atom to hang the molecule from it and watch it swing to rest with its centre of mass straight below.

**Framing:** capability->problem

**Builds on:** C021 (reuses release-velocity estimate and catch) + C032's salvaged rigid-bounce spirit, but with real mass distribution; feeds Star-Trail rosettes and Music Box

**Problem:** Every molecule already carries a real inertia tensor, computable from Lupi's element masses (packages/core/src/elements.ts) and its coordinates. Nothing uses it, so C021's flick is a camera turntable that feels identical for water and C60, and 'weight' is never felt. Awwwards-level 3D in 2026 is praised for 'a single object rendered with real weight' (https://www.utsubo.com/blog/best-threejs-websites-2026). The tennis-racket theorem is one of the most delightful real physics surprises, and exists online mostly as videos and desktop apps (COMSOL, Wolfram SystemModeler, Mathematica GIFs).

**Solution:**

Sources:
- The tennis racket theorem (https://en.wikipedia.org/wiki/Tennis_racket_theorem).
- COMSOL's simulation app (https://www.comsol.com/model/dzhanibekov-effect-89531).
- Enderlein's Euler-equation animations (https://www.joerg-enderlein.de/dzhanibekov).

Model:
1. On load (≤ 5k atoms), compute:
   - the centre of mass;
   - the inertia tensor in amu·Å², giving the principal moments I1≤I2≤I3 and axes via a hand-written 3x3 Jacobi, since math has no eigen solver;
   - a rotor classification: spherical, symmetric (prolate or oblate), asymmetric or linear.
2. In Weightless (a Play-chip verb), a flick no longer spins the camera on a turntable.
   - The release velocity estimate (C021's coalesced events) becomes an angular momentum L on the molecule.
   - Torque-free Euler equations evolve ω in the body frame: RK4 at a fixed 1/240 s inside a hand-written accumulator in the scheduler's 'physics' phase, because scheduler 0.2.0 has no fixed timestep.
   - Orientation updates by q ← q ⊗ exp(½ω·dt) (math quat.exp and multiply). |L| is renormalized each step, so it never gains energy.
3. What visitors see:
   - Asymmetric tops wobble.
   - Symmetric tops precess cleanly.
   - A 'Show me the flip' button (or the I key) spins about the intermediate axis with a 1-2% off-axis nudge, chosen so the first flip arrives within about 3-5 s. Each flip earns a soft 'clunk' and hit-stop (Juice Pass).
4. Readouts: a small tri-axis gizmo labelled I1, I2, I3, plus a chip '1 : 1.8 : 2.6, asymmetric top'. Tap catches (C021), and a pinch keeps zooming the camera.
5. Hang: long-press an atom (after the D2 long-press arbitration) to pin a thread there.
   - Gravity points screen-down, or device-down after the shared sensor-permission flow, which makes it a plumb bob.
   - It is a damped physical pendulum: I about the pin by the parallel-axis theorem, and torque r_cm × Mg.
   - It swings and settles in about 2-3 s on a 'brass pendulum' token. Hanging caffeine by a hydrogen and then by a ring carbon shows where its mass really is.
6. Battery: space has no friction, but after 20 s untouched a labelled 'air' damping fades in and it sleeps at settle. Hidden tabs pause.
7. Exit: the orientation is folded into an equivalent camera pose (camera = q⁻¹), so the viewer, picking, measurements and export see a pure camera change.

**Experience:**

Desktop:
- Flick with the mouse; I spins about the intermediate axis.
- Shift+arrows apply torque impulses about the screen axes.
- H hangs from the focused atom (atom cursor).

Phone:
- A thumb flick throws it.
- The 'Show me the flip' chip sits in the thumb zone.
- Hang by long-press.
- The tilt-to-plumb option appears only after the explicit Sensors tap, with a 'sensors on' indicator in the Status Island.

Screen reader: 'Caffeine: asymmetric top. Spinning about the middle axis is unstable; it flipped 3 times in 10 seconds.' (measured from the simulation, not asserted). 'Hanging from H7: centre of mass is 3.1 Å below the pin.'

Reduced motion: three stills (spin about the long, middle and short axes), labelled 'stable, unstable (flips), stable', with an opt-in 'play once, 4 s'.

**Tech:**

- math@0.1.0 quat.multiply, exp and normalize, vec3 and mat3.
- A hand-written Jacobi eigen routine (math has none).
- RK4 on Euler's equations with a fixed-step accumulator in the scheduler 'physics' phase (0.2.0 has no fixed step).
- Masses from packages/core/src/elements.ts.
- A rigid group transform on the molecule root, with no shader involvement.
- Sources: Wikipedia, COMSOL, Wolfram SystemModeler (https://www.wolfram.com/system-modeler/examples/education/mechanical-engineering/tennis-racket-theorem/index.php.en).

**Backend:** DOM/CPU (renderer-agnostic rigid transform)

**Rides (v10 requirements):** none (ships on v9); R7 scheduler physics phase after the port

**v9 slice:** All of it. It is a CPU rigid-body integrator driving the molecule root group's quaternion inside the existing R3F 9 scene, plus the gizmo and readouts, with no GLSL.

**WebGL2 fallback:** Identical on every backend. Low Power Mode: the fixed-step accumulator keeps the physics wall-clock-exact at 30 Hz. Visual smoothness drops, but the flip timing does not.

**Where in code:**

- New packages/ui/src/play/rigidBody.ts (inertia, Jacobi, RK4, pendulum).
- Molecule root group in packages/ui/src/app/ViewerScene.tsx.
- Bake-to-camera on exit in packages/ui/src/app/CameraManager.tsx.
- packages/scene/src/AtomPicker.tsx must honour the group's world matrix (verify).
- Masses from packages/core/src/elements.ts.

**Risks:**

- Picking, labels, measurements and trails must all respect the group transform; audit every consumer.
- Export must fold q into the camera.
- Near-symmetric tops (I1≈I2) give slow, unconvincing flips; show the flip button only when the moments differ by more than 10%.
- Long-press is contested (loupe, tug, hang), so D2 must arbitrate.
- Continuous spin costs battery without the air-damping rule.

**Honesty:** The chip reads 'Classical rigid-body rotation with real atomic masses. Real molecules rotate quantum-mechanically; this is the classical picture.' Inter-atomic geometry never changes: it is a rigid transform, and export sees only the equivalent camera. The flip counts and periods shown are measured from the simulation.

**Judges:**

- E 4/merge: Merge into R2-joy-and-mastery-03. It is the third True Spin and Dzhanibekov pitch; its hang-by-an-atom mode overlaps pocket-06. *Improve:* Add its gizmo and readouts to True Spin.
- P 4/merge: The same Dzhanibekov rigid-body spin as True Spin, plus a hang mode that Plumb Line already covers. Host: R2-joy-and-mastery-03. *Improve:* Merge, keeping its measured flip counts in the captions and sending the hang to Plumb Line.
- A 3/merge: Host: R2-joy-and-mastery-03. It is the same Euler-equation coast as True Spin. *Improve:* Merge. Hanging from an atom goes to pk-06.
- Pr 4/merge: Merge into R2-joy-and-mastery-03. It is the same physics, and rotating the root group risks picking and export. *Improve:* Use camera-equivalent rendering.
- M 3/merge: Merge into JM-03, with its hang half going to P-06. *Improve:* Keep its three-stills reduced-motion card.

<a id="r2-cross-pollination-scout-04"></a>
## Roll a Nanotube: fold graphene like paper, get the real (n,m) tube and its verdict
`R2-cross-pollination-scout-04` · science-toy · effort M · judges mean **3.6** (E3 P4 A4 Pr4 M3; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> Drag an arrow across a graphene sheet. It snaps hexagon by hexagon to a chiral vector such as '(6,6) armchair' or '(7,4) chiral'. Let go and the sheet curls like a page into the exact (n,m) nanotube, with a verdict card: 'n−m divisible by 3, so metallic'.

**Framing:** problem->solution

**Builds on:** C036 (parked twist) salvaged as a real-outcome deformer; C027 contract; lands on gallery cnt_6_6 and C060 (peapod)

**Problem:** The gallery ships graphene_ribbon (112 atoms), a (6,6) nanotube (cnt_6_6, 96 atoms, exactly 4 unit cells) and C60, but nothing connects them. Nanoscience's most famous structure-property rule is that a tube is a rolled sheet and the roll angle decides metal or semiconductor, and it is invisible. Round 1's ribbon toy (C036 Twist) was parked: it fits two items and fights pinch-zoom.

**Solution:**

Mechanism: the paper toy and origami fold, plus the page-curl bend deformer. The science follows standard chiral-vector geometry, as used by e.g. https://github.com/slastrzelec/carbon-nanotube-visualizer (ASE-based).

Beats:
1. The 'Roll' verb appears on sheet-like structures. A generated flat patch of k unrolled unit cells for the target (n,m) replaces the ribbon with a quick crossfade labelled 'ideal sheet'.
2. Drag a vector: it snaps to C = n·a1 + m·a2 with 0 ≤ m ≤ n, with a detent tick and plink per hexagon. The chip updates live: '(8,0) zigzag · Ø 6.3 Å · semiconducting'. The diameter is a√(n²+nm+m²)/π with a = 2.46 Å.
3. Release: curvature κ springs from 0 to 2π/|C| on the 'glide' token.
   - A closed-form bend deformer maps each atom's coordinate u along Ĉ to angle θ = κ·u around an axis along T.
   - Partial curvature reads as a paper scroll.
   - At κ_final, the positions equal the generated tube's coordinates, because the flat patch is built as the unrolled unit cells with identical atom ordering, so the swap to the real structure is invisible.
4. Verdict card:
   - 'metallic if (n−m) is divisible by 3 (zone-folding rule)', with the caveat 'small non-armchair tubes open tiny curvature gaps'.
   - Chiral angle, atoms per unit cell, and a Learn link.
5. Prompts, not goals:
   - 'Roll the gallery's (6,6)': the result lands on the real cnt_6_6 entry.
   - 'Make a metallic zigzag': (9,0).
   - 'Roll a tube wide enough to swallow a C60': (10,10), Ø 13.6 Å. C60 peapods are real, so this ends with a C60 dropped inside as a labelled 'peapod (known structure type, illustrative placement)'.
6. Unroll: drag back, or the Unroll chip.
7. Every rolled tube can be saved as a real structure with a provenance line: 'generated ideal (n,m) SWCNT, unrelaxed, a = 2.46 Å'.

**Experience:**

Desktop: drag the vector with the mouse; the scroll wheel stays zoom. Phone: one-thumb drag in Roll mode, where pinch still zooms; release rolls. Detent plinks sound, and Android vibrates on each hexagon.

Keyboard:
- Left and Right change n; Up and Down change m.
- The verdict is announced on each change.
- Enter rolls; Backspace unrolls.

Screen reader: '(7,4), chiral, 7.6 Å wide, semiconducting because 7 minus 4 is 3... wait, 3 is divisible by 3: metallic.' The wording is computed, so it is always right: '(7,4): n minus m equals 3, divisible by 3, so metallic by the zone-folding rule.'

Reduced motion: three stills (flat with the vector, half-rolled, tube) with crossfades.

**Tech:**

- CNT generator in packages/core: pure TS, deterministic, using the standard unit-cell algorithm (d_R = gcd(2n+m, 2m+n), T = ((2m+n)/d_R)·a1 − ((2n+m)/d_R)·a2, 2N atoms per cell). Golden-tested against cnt_6_6.
- Closed-form bend deformer in the TSL positionNode (R3), with a CPU twin for picking.
- Bonds follow through R4 pairs, and a roll preserves bond lengths to first order.
- math@0.1.0 vec2/vec3 and spring.update for κ.
- polygon2 is not needed.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (positionNode deformer), R4 (bond pairs); C027 contract

**v9 slice:** For patches of 1k atoms or fewer, compute bend positions on the CPU each frame during the ~900 ms roll and upload through the existing position path. The linear uProgress lerp would cut through the tube interior, so it is avoided. The roll ends by loading the generated tube as a normal file. The generator, verdict and prompts all ship on v9 with no GLSL.

**WebGL2 fallback:** Identical: pure vertex math with no compute. Low Power Mode: the roll takes the same wall-clock time on the analytic spring.

**Where in code:**

- New packages/core/src/nanotube.ts, with a golden test against apps/web/public gallery cnt_6_6.
- packages/ui/src/play/roll.ts.
- Gallery entries graphene_ribbon and cnt_6_6 in packages/ui/src/gallery-data.json.
- Optionally a procedural 'nanotube' input on the lupi.generate_molecule path (packages/ui/src/mcpViewerBridge.tsx). That changes the browser MCP manifest, so regenerate it.

**Risks:**

- An arbitrary ribbon can't roll into a clean tube, which is why the flat patch is regenerated per (n,m). Explain the swap with the 'ideal sheet' label.
- Edge hydrogens are absent on generated sheets.
- Very small n (<4) gives unphysical tubes, so clamp n.
- The metal rule has exceptions at small diameter; state the caveat.
- Roll mode needs Play-chip ownership of one-finger drag.

**Honesty:** 'Real nanotubes grow from catalysts. Nobody rolls them; the curl is a folding illustration.' The resulting tube is the ideal, unrelaxed (n,m) geometry, and the metallic verdict is the zone-folding rule with its small-diameter caveat, cited. Peapod placement is labelled illustrative.

**Judges:**

- E 3/merge: Merge into R2-real-twins-science-09. The deterministic CNT generator (golden-tested against cnt_6_6) and the closed-form bend deformer are sound. It is the inverse of the unroll. *Improve:* Ship the roll as the reverse direction of real-09's bend deformer.
- P 4/keep: Dragging a chiral vector hexagon by hexagon, with ticks, then watching the sheet curl like a page into the real (n,m) tube with a verdict is satisfying, and the outcome is real. *Improve:* Host the unroll from Carbon Shape Proofs, and offer three preset vectors for one-tap play.
- A 4/keep: A page-curl roll into an exact (n,m) tube is beautiful motion with a real outcome. *Improve:* Share the arc-length-exact deformer with rt-09, and snap the chiral-vector arrow on the snap token.
- Pr 4/keep: A real (n,m) outcome with a verdict, 'n−m divisible by 3, so metallic', is a crisp teachable fact, and it lands on the gallery's cnt_6_6. The sheets it generates are derived and need provenance. *Improve:* Label generated sheets 'derived, ideal'.
- M 3/keep: The drag snaps per hexagon, but it needs a non-drag path. *Improve:* Add (n,m) steppers and keys under WCAG 2.5.7.

<a id="r2-cross-pollination-scout-05"></a>
## Kaleidoscope: find a molecule's symmetry by making the seams disappear
`R2-cross-pollination-scout-05` · game · effort M · judges mean **3.0** (E3 P4 A3 Pr3 M2; keep 2, rework 1, merge 2) · self-scored fun 4 / visual 5 · perf neutral

> Turn on the kaleidoscope and the live view folds into mirrored wedges. Rotate benzene until the six-fold kaleidoscope goes seamless and it clicks onto the true axis with a chime. C60 hides 6 five-fold, 10 three-fold and 15 two-fold axes to collect, and caffeine never goes seamless.

**Framing:** capability->problem

**Builds on:** C076 (mirror) generalised to rotations; C048/R6 pipeline; C094 stamps; D5 observation-prompt toys (C60 'find the icosahedron')

**Problem:** With v10, a single fullscreen TSL pass can fold the live frame into wedges almost for free, on both backends. Meanwhile symmetry, the organising idea of chemistry, has no toy in Lupi. C076 covers only mirror images, and point groups hide in textbooks. The Exploratorium's Active Prolonged Engagement research found that exhibits work when visitors pose and test their own questions ('is there an axis here?') rather than read answers (https://www.exploratorium.edu/exhibit-collection/active-prolonged-engagement).

**Solution:**

The mechanism is the kaleidoscope toy: two or three mirrors at 180°/k.

Modes:
- Mirror: dihedral wedges, alternately reflected.
- Turn: cyclic copies, no reflection.
- k = 2 to 6, plus 'one mirror' (k = 1).

The camera switches to orthographic (Lupi's impostors already support ortho), so projection is exact. The fold centre is the projection of the centre of mass, which every point-group element passes through.

The seam meter is computed in 3D, not from pixels.
- For the current view axis a, test the real operations whose projections the fold imitates: C_k about a, and in Mirror mode also a mirror plane containing a or a 2-fold axis perpendicular to a. A perpendicular C2 projects as a mirror line, so both count, and the verdict names which one matched.
- The test maps each atom to its nearest same-element atom through SpatialHash, giving an RMS deviation in Å.
- It runs at 15 Hz only while you rotate, on structures up to 500 atoms.
- The meter reads 'seam 0.84 Å … 0.02 Å'.

Snap: below 0.3 Å the camera springs onto the nearest symmetry element from a manifest baked at curation time, followed by a chime, a seamless image and hit-stop. The manifest comes from tools/build-symmetry.mjs, which runs a candidate-axis detector (principal axes, centre-of-mass-to-atom directions, bond midpoints; after Largent-Polik-Schmidt/Symmetrizer, https://pubmed.ncbi.nlm.nih.gov/22549414/, as used by WebMO, https://www.webmo.net/link/help/Symmetry.html) with a stated tolerance.

Collection: each molecule gets an axis checklist, for example C60: C5 ×6, C3 ×10, C2 ×15; benzene: C6 ×1, C2 ×6; water: C2 ×1 plus 2 mirrors. Found axes stamp into the Passport (C094). A chiral propeller that passes Turn but fails Mirror hands off to C076 with 'this one has a handedness'.

Visual: a TSL pass on the scene pass texture. It converts screenUV to polar about uCentre, folds the angle (Mirror: |mod(θ, 2π/k) − π/k|; Turn: mod(θ, 2π/k)) and samples. Wedge seams get a hairline that fades as deviation → 0, so 'seamless' is visible even when atoms are small.

**Experience:**

Desktop: drag to rotate as usual. The K key toggles the lens, [ and ] change k, and M/T switch Mirror and Turn. Phone: the Kaleidoscope chip, thumb drag to rotate and a k stepper in the thumb zone. The fold updates only while you drag; at rest it is one frame.

Keyboard: arrows rotate in 1° steps and snap engages the same way, so the whole game is keyboard-complete.

Screen reader: 'Six-fold mirror. Seam 0.4 Å … 0.02 Å: match. Found a 6-fold axis, 1 of 1. Benzene also has 6 two-fold axes.'

Reduced motion: the snap is instant. The fold is shown as a still per action, and the seam meter plus chime carry the feedback. A motion-sickness budget applies: rotating kaleidoscopes are intense, so the lens caps angular velocity, and a 'wedge guides only' option draws seam lines without folding the image.

**Tech:**

- TSL pass(scene, camera) → Fn over screenUV (polar fold) inside useRenderPipeline (R6); [GPU+GL2] fullscreen.
- Orthographic camera while the lens is open.
- CPU: SpatialHash nearest same-element matching; math@0.1.0 quat.setAxisAngle and vec3.transformQuat into scratch tuples.
- A build-time symmetry manifest with detector, tolerance and version (provenance).
- Sources: Symmetrizer (PubMed), WebMO help, Exploratorium APE (links in problem and solution).

**Backend:** mixed (CPU seam meter; fold pass [GPU+GL2])

**Rides (v10 requirements):** R6 (fold pass in the render pipeline); build-time manifest needs no R#

**v9 slice:**

The whole game minus the image fold:
- CPU seam meter, snap spring, chime and axis checklist;
- an SVG overlay drawing the k wedge guide lines about the projected centre of mass;
- the symmetry manifest tool.

No GLSL.

**WebGL2 fallback:** The fold is one fullscreen texture pass and works on the WebGL2 backend. If a device is slow, the lens falls back to 'wedge guides only' (SVG), and the game still works because the meter is CPU.

**Where in code:**

- New packages/ui/src/play/kaleidoscope.ts.
- A fold node in the R6 pipeline module (successor to packages/ui/src/postprocess/).
- tools/build-symmetry.mjs writes packages/ui/src/gallery/symmetry.json.
- The ortho toggle in packages/ui/src/app/CameraManager.tsx.
- Stamps via the C094 passport.
- Learn panel link to the point group.

**Risks:**

- Kaleidoscopes can be dizzying; the angular cap and wedge-guides option are mandatory.
- Flexible molecules are only near-symmetric, so tolerance must be tuned per entry and stated.
- Lattices are out of scope (space groups).
- The detector is build-time work that needs a content-steward review per molecule.
- The perspective camera would break exactness, so ortho is forced while the lens is open.

**Honesty:** The fold is a visual device. The match is decided from real coordinates within a stated tolerance ('symmetric within 0.05 Å'), and each found element is named in words. Manifests carry detector, tolerance and version. No atom moves: it is camera plus post only, and export excludes it.

**Judges:**

- E 3/keep: The CPU seam meter over SpatialHash is exact. The fold is one fullscreen TSL pass (R6), with an SVG wedge-guide fallback. It is dizzying without caps. *Improve:* Make wedge guides the default on phones, and add the fold to the prewarmed graph set.
- P 4/keep: Kaleidoscopes are pure visual joy, and 'rotate until the seams vanish, then click' is a readable game about real symmetry. The risk is dizziness. *Improve:* Default to wedge guides on phones, and reuse Symmetry Detents' axes and chord.
- A 3/merge: Host: R2-first-minute-flagship-05. A kaleidoscope fold is a stock shader toy that shows atoms which aren't there. The seam meter that falls silent only at a true axis is the clever part. *Improve:* Default to SVG wedge guides. Offer the image fold only as an opt-in lens with a visible bezel.
- Pr 3/merge: Merge into R2-first-minute-flagship-05. A kaleidoscope is a lovely symmetry lens, but dizzying. *Improve:* Make it a later lens mode of the detents.
- M 2/rework: Rotating mirrored wedges are a vestibular and pattern-sensitivity trigger. The wedge-guides option exists but is not the default. *Improve:* Fold only at rest or on snap, make guides the default, and never fold under reduced motion or Gentle.

<a id="r2-cross-pollination-scout-06"></a>
## Star-Trail Shutter: long-exposure prints of your spin
`R2-cross-pollination-scout-06` · share-loop · effort S · judges mean **3.6** (E4 P4 A4 Pr3 M3; keep 5) · self-scored fun 4 / visual 5 · perf neutral

> Open the shutter, spin the molecule, close it. Every atom's highlight leaves a glowing arc, like star-trail photography, and a rear-curtain flash freezes the crisp molecule on top. You get a unique spirograph print of your own gesture, where the pole of the trails is the real rotation axis.

**Framing:** capability->problem

**Builds on:** C060 (shutter) + C061 (idle accumulation as capture) + C103's Instant Replay + capture service (D4); pairs with Weightless

**Problem:** three r186's AfterImageNode computes max(new, old·damp) per pixel, verified in the local 0.186.1 source. That is exactly the 'lighten' stacking astrophotographers use for star trails, available as a TSL node on both backends. Meanwhile every Lupi share image is a screenshot of a default pose, spins vanish the moment they end, and the axis a molecule spun around is never visible. C060's shutter accumulates only while still, and C065's comet tails need trajectory data.

**Solution:**

Mechanism: star-trail photography, where short exposures are stacked with the lighten (maximum) blend (https://capturetheatlas.com/star-trails-photography-guide/, https://gregbenzphotography.com/photography-tips/create-clean-star-trails/), plus the rear-curtain flash of night photography.

Beats:
1. The shutter is a DOM button on the canvas, in the thumb zone. Tap it to open with a 2/4/8 s timer, or hold it (desktop: hold Shift while dragging).
2. While the shutter is open:
   - afterImage(scenePass, uDamp) runs with uDamp = 1, which is pure max-stacking.
   - Bloom is off and exposure is pulled down 0.5 EV.
   - There is an option to stack only the emissive MRT highlight channel, which gives thin, crisp trails.
3. You flick, drag or orbit; the Weightless idea gives tumbling rosettes.
4. Closing fires the rear-curtain flash: one sharp full frame at the final pose, composited over the trails.
5. Presets:
   - Turntable: the camera orbits the principal axis, giving concentric trails whose pole marks the axis.
   - Tumble: Weightless, giving rosettes.
   - Free: you paint.
6. The print goes to the one capture service (R9): a fixed-size target (1080² on phones, 2048² on desktop) → async readback → share sheet, sticker (C105) or card (C106).
7. The camera path is kept in the Instant Replay ring buffer, so 'print larger' re-renders the same exposure frame by frame at higher resolution. That is exact given the path, and an illustrative output, not an MCP artifact.
8. Max-stacking is 8-bit safe: it never sums, so it doesn't band. That keeps the UnsignedByte output rule on mobile.

**Experience:**

Desktop: click the shutter, drag or flick, and it closes on the timer. Phone: tap the shutter with the thumb and flick with the same thumb during the timer; the countdown ring lives in the Status Island. The shutter is a DOM tap, so switch haptics can fire at open and close where that works (unverified on iOS).

Keyboard: Enter on the shutter opens it, and arrows orbit during exposure.

Screen reader: 'Exposure 3.2 s. Trails circle the long axis 1.4 times. Print ready. Share or save.' Alt text is generated from the name, formula, preset and exposure.

Reduced motion: 'Develop' renders the chosen preset path off-screen and shows only the finished print, one still per action. It never flashes: brightness only rises monotonically, and the rear-curtain frame fades in over 150 ms instead of popping.

**Tech:**

- three 0.186.1 afterImage(node, damp) with damp as a uniform. Verified in examples/jsm/tsl/display/AfterImageNode.js: 'return max(texelNew, texelOld)' after 'texelOld.mulAssign(this.damp.mul(m))'.
- useRenderPipeline MRT for the emissive channel.
- Fixed-size useRenderTarget and readRenderTargetPixelsAsync (R9).
- Web Share and ClipboardItem.
- Scheduler: the job runs only while the shutter is open, then onIdle.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R6 (afterImage in the pipeline, MRT emissive), R9 (fixed-size capture target and readback)

**v9 slice:** A 2D accumulator on the viewer route only (never on `/`). Each rAF while the shutter is open, drawImage the WebGL canvas into an offscreen 2D canvas with globalCompositeOperation 'lighten'. v9 keeps preserveDrawingBuffer: true, so this works today, capped at 4 s at 30 Hz. The last frame is the rear-curtain flash, and the result goes to the Web Share sheet. No GLSL.

**WebGL2 fallback:** afterImage is a fullscreen fragment pass and runs on the WebGL2 backend (node-by-node verification pending, per the brief). Low Power Mode: fewer samples per second give dotted trails, so shorten the timer and prefer 'highlights only'.

**Where in code:**

- New packages/ui/src/play/shutter.ts.
- The capture service in packages/ui/src/export/ (with ExportManager.tsx phases per R7).
- v9 accumulator hooked beside packages/ui/src/viewer/ViewerCanvas.tsx.
- R6 pipeline module.
- Status Island countdown.

**Risks:**

- Large, dense structures smear into a blob; use highlights-only above ~20k atoms, or cap.
- Dark looks give faint trails; use exposure compensation per look.
- The v9 drawImage from a WebGL canvas each frame costs a GPU-to-CPU copy on some browsers, which is why the slice is capped.
- The afterImage threshold clears dim pixels; tune the threshold uniform.

**Honesty:** 'Long exposure of the camera path: the atoms didn't move.' In Tumble, the chip reads 'rigid rotation'. Prints are illustrative outputs from the capture service, never MCP artifacts, and carry name and formula captions.

**Judges:**

- E 4/keep: afterImage's max blend exists in r186. The pass costs only while the shutter is open and needs no velocity, so it avoids the temporal −1. The output is a unique personal print. The v9 drawImage accumulator forces a readback per frame, which is acceptable only while the shutter is open. *Improve:* Switch to highlights-only above ~20k atoms, and route output through capture-01.
- P 4/keep: A long-exposure spirograph of your own spin is a unique, personal print: creative play with a share at the end. It has a v9 slice. *Improve:* Make it a shutter mode of the Sideways camera, and offer it automatically after a big flick.
- A 4/keep: Long-exposure prints whose pole marks the real rotation axis use a photographic trope truthfully, and as an output only, so they never muddy the live specimen. *Improve:* Fold it under cap-09 as a shutter mode, and switch to highlights-only trails above about 20k atoms.
- Pr 3/keep: Unique personal art made from your own gesture is shareable, and it is small, with a v9 accumulator. *Improve:* Route it through the Shot service.
- M 3/keep: Brightness rises monotonically and the rear-curtain frame fades in (flash-aware), and reduced motion develops off-screen. But the v9 per-frame drawImage copy is a thermal cost. *Improve:* Use v10 only on phones, cap the timer, and show highlights only above 20k atoms.

<a id="r2-cross-pollination-scout-07"></a>
## Holo Specimen Cards: lit, spinnable molecules on the home page with zero canvases
`R2-cross-pollination-scout-07` · share-loop · effort M · judges mean **3.2** (E3 P4 A3 Pr3 M3; keep 3, rework 2) · self-scored fun 4 / visual 5 · perf neutral

> The home page's molecules become collectible trading cards. Each is a real-renderer turntable baked into a sprite strip you can spin with a thumb, the way product photos spin on a shop page, on a card that tilts and catches glare like a holo Pokémon card. It uses no canvas, no three.js, and gives an exact match frame into the viewer.

**Framing:** problem->solution

**Builds on:** C015 (reworked: baked real renders instead of SVG circles) + C016 (match frame) + C062 rare rolls + C094 (visual payoff) + C106/C109 posters

**Problem:** C015 (SVG pocket molecules) is the only touchable thing proposed for `/`. The art director warned that 'SVG circles with fixed radial gradients will look like clip art next to the 3D viewer', and D1 demands an art-directed SVG-to-3D match frame. C094's passport has 'no visual payoff'. C062's Rare Rolls need a physical-feeling reward. The zero-canvas rule on `/` stands.

**Solution:**

Mechanism sources:
- E-commerce 360° spin viewers: 24-72 prerendered frames swapped as you drag (https://www.ajax-zoom.com/examples/example15.php, https://resources.imagine.io/blog/everything-about-360-degree-product-spin-for-ecommerce-ultimate-guide).
- simeydotme's pokemon-cards-css: pointer-driven CSS custom properties that set the 3D tilt, a glare radial gradient and holo foil layers via background-position and blend modes (https://github.com/simeydotme/pokemon-cards-css, https://poke-holo.simey.me/).

Beats:
1. Bake at curation time. A new tools/build-turntables.mjs drives the real viewer through the browser bridge (lupi.open_gallery_example, then lupi.set_camera at 24 azimuths of 15°) and captures each frame with bonds and the house look.
   - It uses an ordinary canvas capture, not deterministic lupi.export_asset, which rejects bonds. These are illustrative marketing images.
   - Frames are packed into one 256 px WebP or AVIF strip per hero (about 24 × 6-10 KB).
   - An 8-frame (45°) preview strip loads first.
   - The existing tools/build-student-previews.mjs sets the precedent: 'deterministic static previews… run explicitly when curating'.
2. The card is DOM: an `<img>` or CSS background sprite inside a card element.
   - A horizontal drag scrubs frames: frame = round(x / pxPerFrame).
   - Release keeps spinning on a math spring and settles on the hero frame.
   - A vertical drag only tilts the card, since the strip is azimuth-only.
3. Card surface: CSS tilt and glare follow the pointer. Holo foil (color-dodge layers) appears only on earned cards: Rare Rolls (C062), a finished Daily (C088), passport milestones (C094). The foil is visibly cosmetic.
4. Match frame: tap 'Open' and C016's intent prefetch plus FLIP grow the card image to full screen. The viewer mounts at the same azimuth with the same lighting, because the frames were rendered by it. The judges' match-frame problem is solved by construction.
5. The same cards serve as `/m/:id` page heroes, C109 embed posters, passport stamps and the Daily's reveal card.

**Experience:**

Desktop: hover tilts the card with glare, and drag spins it. Phone:
- A horizontal thumb swipe inside the card spins it, with touch-action: pan-y so vertical page scroll is untouched and an edge dead zone for the iOS back-swipe.
- Tilt-with-phone is offered only after an explicit 'Tilt' tap (the shared permission flow).

Keyboard: cards are focusable; Left and Right step frames with a detent click (optional sound), and Enter opens the viewer at that angle.

Screen reader: alt text reads 'Caffeine, C8H10N4O2, rotatable card, view 7 of 24'. The holo state is announced as 'rare card'.

Reduced motion: no tilt, glare animation or inertia; arrows step frames, one still per action.

Data: on Save-Data, only the existing static preview shows. Strips load on intent (pointerdown, focus, or in-viewport after idle) and never block LCP.

**Tech:**

- Playwright plus window.__lupiViewerMcp for baking.
- WebP/AVIF sprite strips.
- CSS custom properties, 3D transforms and mix-blend-mode (pokemon-cards-css technique).
- math@0.1.0 spring.update for frame inertia; plain rAF that stops on settle, with no scheduler root on `/`.
- IntersectionObserver and content-visibility.
- View Transitions or FLIP for the hand-off (C016).

**Backend:** DOM/CPU (zero canvases; frames baked by the real renderer)

**Rides (v10 requirements):** none (ships on v9); re-bake after R3/R6 as part of look-parity goldens

**v9 slice:** All of it: the bake tool drives today's v9 viewer, and the cards are DOM. After the port, re-bake; the strips double as look-parity goldens.

**WebGL2 fallback:** Not applicable on `/`: the frames are images. The baked look is the WebGPU house look, and the viewer on the GL2 backend should match it within the look-parity tolerance, which is checked against the same frames.

**Where in code:**

- New tools/build-turntables.mjs (modelled on tools/build-student-previews.mjs and the Playwright verify tools).
- Output under apps/web/public/turntables/.
- New packages/ui/src/landing/SpecimenCard.tsx used by packages/ui/src/landing/MoleculeWall.tsx and GallerySection.tsx.
- packages/ui/src/landing/student-home.css.
- Keep tests/ui/student-surface.spec.ts at 0 canvases.

**Risks:**

- Bytes on `/`: about 80 KB for a preview strip and 150-250 KB for a full hero strip. It needs intent loading and a Save-Data path, and must never load in the LCP window.
- The owner must approve motion on home (it starts still and moves only on touch).
- CSS blend modes can be heavy on low-end phones, so apply them only to the active card.
- An azimuth-only strip can't show pole views.
- The bake pipeline is another curation step and needs content-steward review.

**Honesty:** The existing footnote applies: 'rendered views of the coordinate model, not photographs'. Holo and foil are cosmetic rarity only, never on data-bearing surfaces, and never tied to a property. Strips are illustrative marketing images, not MCP artifacts.

**Judges:**

- E 3/keep: Baked sprite strips keep / at zero canvases, and the bake doubles as goldens. Still, 80-250 KB and CSS blend-mode decoration on home need an owner call against the calm-home rule. *Improve:* Load on intent only, never in the LCP window, and hold on the owner decision.
- P 4/keep: A holo card that glints as you tilt it and spins a real render is an instant 5-second smile on /, with zero canvases. But it's a one-axis turntable, not an object you can tumble, and its bytes on / need care. *Improve:* A/B it against the SVG hero, load strips only on intent, and use one hero card rather than a wall.
- A 3/rework: Baked real-renderer turntables solve the match frame by construction and double as goldens. But pokemon-card holo glare and tilt on / are a stock trope that cheapens a specimen brand, and they compete with the ink landing (sig-06). *Improve:* Drop glare and holo from the home page. Use the strips as /m/:id heroes and embed posters, and give earned cards a foil only in the Notebook.
- Pr 3/rework: It adds 80-250 KB of image strips and touch-driven motion to /, which needs the owner's call. Holo foil also doesn't belong on a student home page. *Improve:* Put the strips on /m pages and cards instead.
- M 3/keep: Zero-canvas home cards, no tilt under reduced motion, and Save-Data falls back to the static preview. But it adds 80-250 KB on /. *Improve:* Keep it out of the LCP window, load strips on intent, and give each card alt text.

<a id="r2-cross-pollination-scout-08"></a>
## Droplet Lens: a Liquid Glass loupe that magnifies the frame you already rendered
`R2-cross-pollination-scout-08` · system · effort M · judges mean **2.8** (E3 P3 A2 Pr3 M3; merge 5) · self-scored fun 4 / visual 4 · perf improves

> Long-press and a drop of liquid glass swells above your thumb, bending and magnifying the molecule under it with a refractive rim. Its crosshair snaps to the nearest atom and releasing selects it, so the finger finally hits the atom it meant, without re-rendering a million atoms.

**Framing:** problem->solution

**Builds on:** C024 (reworked exactly per judges) + C009 (ID patch snap); material shared with Status Island and D2 Play chip

**Problem:** Fingers cover the atom they aim at. C024 (Thumb Loupe) was sent back for rework: its crop re-render repeats all vertex work at 1M+ atoms, and its radius swell alters data. The judges' fix was to 'magnify the already-rendered colour target, make hold-slide-release the phone's precise select, and use a light rim instead of a swell'. Separately, the phone chrome needs a material that separates controls from content without hiding the molecule.

**Solution:**

Mechanism sources:
- Apple's Liquid Glass lensing: glass is the control layer floating above content, and it bends light to show hierarchy (https://developer.apple.com/videos/play/wwdc2025/219/).
- Codrops' 'Infinite Liquid Glass Grid' (2026-09-08) builds exactly this in TSL: a roundedBoxDistance SDF heightfield, normals from height-map slopes, refract(viewDir.negate(), normal, eta) taps with slightly different IOR per channel for rim dispersion, a Fresnel rim, and tap count as the quality knob (https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/).
- WebGL2 and CSS precedents: https://github.com/Oliverrr2424/webgl-apple-liquid-glass, https://github.com/eirasmx/webglass.

Design:
1. Gesture: long-press of at least 350 ms with under 8 px of movement, following the D2 thresholds against tug and hang.
2. A small quad (about 140 px) in an overlay pass carries a MeshBasicNodeMaterial whose colorNode samples the main scene pass texture:
   - centre magnification of 2× through the lens profile;
   - refraction taps (4 on phones, 8 on desktop) with dispersion only at the rim;
   - a Fresnel rim.
   Cost is limited to the lens pixels, with no re-render.
3. Position: the drop sits 72 px above the finger, flipping sideways near edges. It follows on a spring, with a gentle squash-stretch along velocity (the 'gel' feel).
4. The crosshair snaps to the nearest atom via C009's finger-sized ID patch read. The snapped atom gets a light rim, never a radius change, and its symbol and name ride the drop's edge as a tag.
5. Release selects the atom and hands off to the ordinary inspect or annotate flow. Flicking the drop off-screen cancels.
6. Desktop: holding Alt turns the cursor into a small lens, the reworked lens cursor.
7. Keyboard and low vision: the lens can follow the D2 atom cursor, a magnifier tracking keyboard focus.
8. The same glass material, via CSS on DOM chips in Chromium or as a flat frosted fallback, styles the Play chip and Status Island. Glass is only ever the control layer, per HIG.

**Experience:**

Phone: hold, slide and release, the iOS-magnifier muscle memory. The canvas sets -webkit-touch-callout: none and user-select: none so iOS doesn't open text selection. Android vibrates on each snap to a new atom. Desktop: hold Alt to get the lens cursor, then click to select.

Keyboard: L toggles 'lens follows focus' in atom-cursor mode.

Screen reader: the snapped atom is announced ('Oxygen 3, bonded to C2 and H7'). The lens is visual sugar on top of the accessible selection path.

prefers-reduced-transparency: the drop becomes an opaque magnifier with a solid ring, with no refraction or dispersion. forced-colors: a system-colour outline. Reduced motion: no squash-stretch; the drop appears and moves 1:1.

**Tech:**

- TSL: pass(scene, camera).getTextureNode() sampled from a MeshBasicNodeMaterial colorNode on an overlay quad.
- SDF squircle heightfield, refract(), per-channel eta taps and Fresnel (Codrops technique).
- useRenderPipeline (R6).
- The ID patch from C009's RGBA8 ID target with readRenderTargetPixelsAsync.
- math@0.1.0 spring2 for follow and polar for the squash direction.
- v9 progressive enhancement: CSS backdrop-filter with an SVG feDisplacementMap (webglass), Chromium-only.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R6 (scene pass texture), R3 (ID MRT via C009)

**v9 slice:**

The precise-select mechanics without the glass:
- long-press, then a DOM bubble above the thumb with a crosshair and atom tag;
- snapping by the existing CPU AtomPicker, rAF-throttled;
- release to select.

On Chromium, an optional CSS backdrop-filter plus SVG displacement 'glass' ring. No GLSL.

**WebGL2 fallback:** Texture sampling and refraction math run on the WebGL2 backend; drop the tap count to 4. Low Power Mode: 2 taps and no dispersion.

**Where in code:**

- New packages/ui/src/play/DropletLens.tsx.
- Overlay pass in the R6 pipeline module.
- Snapping via C009's ID target; on v9, packages/scene/src/AtomPicker.tsx.
- Long-press thresholds in the D2 gesture module.
- Pointer wiring in packages/ui/src/app/ViewerScene.tsx.

**Risks:**

- Magnifying pixels at 2× is soft by nature; cap magnification and don't promise 3×.
- Long-press is contested (tug, hang, Crystalscaper remove), so D2 must arbitrate by mode.
- The overlay quad must sample the pre-output or post-output texture consistently to avoid double tone mapping.
- Refraction can hurt legibility of the atom tag, so the tag sits outside the glass.

**Honesty:** The drop is 'a magnified image of the current frame'. Radii and positions are never changed, and the selection is the real picked atom. Nothing reaches export.

**Judges:**

- E 3/merge: Merge into R2-pocket-native-play-02. Refraction taps and dispersion are decoration on a precision tool, and they carry the same frozen-frame issue (PassNode re-renders per frame). *Improve:* Offer the glass rim as a cosmetic option on Loupe 2.0's snapshot overlay.
- P 3/merge: A refractive liquid-glass rim is juicier than a plain bubble, but the functional core is Loupe 2.0. Host: R2-pocket-native-play-02. *Improve:* Merge it as a desktop and WebGPU skin, and never let the refraction hide the snapped atom.
- A 2/merge: Host: R2-pocket-native-play-02. Liquid Glass with per-channel dispersion is a 2025 OS trope, and refraction distorts exactly what you are trying to aim at. *Improve:* Keep pk-02. Borrow at most a glass rim for the edge.
- Pr 3/merge: Merge into R2-pocket-native-play-02. It duplicates the loupe. *Improve:* Make liquid glass an optional style.
- M 3/merge: Merge into P-02. Refraction taps cost more on tile GPUs. *Improve:* Keep the glass rim contrast at 3:1, with no dispersion in LPM.

<a id="r2-cross-pollination-scout-09"></a>
## Status Island: one morphing capsule for everything that's live
`R2-cross-pollination-scout-09` · system · effort S · judges mean **3.0** (E3 P3 A2 Pr3 M4; keep 2, merge 3) · self-scored fun 3 / visual 4 · perf neutral

> A single capsule, like the iPhone's Dynamic Island, becomes the one home for live state. 'Illustrative motion · Reset', 'Sensors on · Stop', 'Recording 3 s', 'Time reversed', 'Secret found 4/12' and the Remix code all morph in and out of the same pill. Two activities split it into a pill and a bubble.

**Framing:** problem->solution

**Builds on:** C027 (illustrative chip as Play control and reset) + D2 (sensors indicator, one-tap reset) + C019/ViewerGestureHint + C103/C062/C063/C073 chips

**Problem:**

Round 1 and its round-2 brief each require a different on-canvas chip:
- the illustrative-motion chip that doubles as the Play control and reset (C027);
- a visible 'sensors on' indicator (D2);
- a recording indicator (C103);
- a secrets meter (D7);
- a custom-colours badge (C063);
- an amplitude chip (C073);
- the Remix code (C062);
- loading progress (C016);
- low-power messaging (D6).

Today the viewer already has separate ViewerGestureHint, RendererWarningToast, PlaybackStatus and SavedViewLoadState components. Put all of that on a phone canvas and the chrome eats the molecule, and the honesty labels become noise that nobody reads.

**Solution:**

Mechanism: Apple's Dynamic Island, a single physical-feeling capsule that morphs between compact, expanded and split states for live activities with interruptible springs. Web and React implementations exist (https://github.com/JUNERDD/react-dynamic-island, https://beui.dev/components/blocks/dynamic-island), and the HIG glass-as-control-layer guidance applies.

Spec:
1. Activity registry. Each activity declares:
   - id and priority tier: safety/honesty > capture > progress > delight;
   - a glyph and a compact label of at most 3 words;
   - an expanded view (a small sheet);
   - at most 2 actions;
   - aria-live politeness;
   - an expiry.
2. Layout:
   - At most 2 concurrent activities: the highest is the pill and the next is a split bubble. Anything else queues.
   - Delight items auto-expire after 2.5 s. Safety items persist while true.
3. Rules, enforced in code and CI:
   - No illustrative deformer may run without an active 'Illustrative motion · Reset' activity. The deformer registry refuses to start otherwise, which turns C027's badge into a guarantee.
   - Sensors can't be on without 'Sensors on · Stop'.
4. Motion:
   - The shell animates via clip-path: inset(round) and transforms on C003's motion tokens (a long spring with barely any bounce). No layout thrash.
   - It is interruptible: collapsing mid-expand reverses from the current size.
   - Content crossfades with a slight blur.
5. Placement:
   - Phone: bottom-centre, floating above the command deck, in the one-thumb reach zone rather than the top as on iPhone.
   - Desktop: top-centre under the header.
6. It absorbs the existing hint, toast and status components as activities.
7. Its buttons are direct DOM taps, so they are the best host for iOS switch haptics (unverified; needs a device test).

**Experience:**

Desktop: glance at the pill; click to expand; Escape collapses. Phone: it sits above the deck where the thumb reaches; tap to expand and tap Reset or Stop. Drag down to dismiss a delight item. Safety items can't be dismissed while active.

Keyboard:
- F6 cycles landmark regions and the island is one of them.
- Tab reaches its actions.
- Shift+R triggers Reset from anywhere, mirroring the island's action.

Screen reader: role='status' with polite, de-duplicated announcements ('Illustrative motion on. Reset available.'). Safety changes use assertive once. The expanded view is a disclosure.

Reduced motion: an instant size change with a 120 ms crossfade and no spring. Forced colors: a solid system-colour outline. prefers-reduced-transparency: opaque.

**Tech:**

- React plus math@0.1.0 spring.update (C003 tokens).
- CSS clip-path inset() with round, and transform-only animation.
- A zustand store slice for the activity queue.
- aria-live regions.
- Optional CSS glass (backdrop-filter) shared with the Droplet Lens.
- The iOS switch-haptic overlay on its buttons (unverified; iOS 26.5 behaviour per the fact sheet).

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (ships on v9); becomes the enforcement point for C027's contract after R3

**v9 slice:** All of it. Ship the island first with today's gesture hint, renderer warning, playback status and saved-view load state as its first activities. Every later toy registers into it.

**WebGL2 fallback:** Not applicable (DOM). On the WebGL2 backend it hosts the honest 'lite' message ('Running on WebGL2: some effects are simplified') as a one-time progress-tier activity.

**Where in code:**

- New packages/ui/src/app/StatusIsland.tsx and a store slice in packages/ui/src/store.
- Absorbs packages/ui/src/app/ViewerGestureHint.tsx, RendererWarningToast.tsx, PlaybackStatus.tsx and SavedViewLoadState.tsx messages.
- Mounted in packages/ui/src/ViewerApp.tsx.
- The deformer registry (C027) calls the island's register API.

**Risks:**

- It could become a notification junk drawer. The priority tiers, 3-word cap and 2-concurrent limit are non-negotiable.
- aria-live chatter; de-duplicate and rate-limit.
- Bottom placement competes with the Play chip and deck on small phones, so D6 layout must place both.
- It absorbs four existing components, so regression tests must move with it.

**Honesty:** This is where honesty becomes structural. Illustrative motion, sensors and time-reversed playback can't run without their words visible here, with a one-tap reset. Nothing here is exported.

**Judges:**

- E 3/keep: One DOM capsule for live state, with priority tiers, is cheap and ships on v9. It overlaps play-03's Illustrative/Reset surface and risks becoming a junk drawer. *Improve:* Choose one home for Illustrative/Reset between this and play-03, and enforce the 2-concurrent cap.
- P 3/merge: A morphing capsule is lovely UI juice, but a second persistent pill beside the Play chip splits attention. Host: R2-play-for-everyone-03. *Improve:* Make the Play chip itself the capsule that morphs through 'Illustrative · Reset', 'Sensors on' and 'Recording'.
- A 2/merge: Host: R2-play-for-everyone-03. A Dynamic Island clone is a second persistent capsule on the canvas and an imitation that will date. *Improve:* Fold its states and priority tiers into the Play chip.
- Pr 3/merge: Merge into R2-play-for-everyone-03. A second persistent pill would compete with the Play chip. *Improve:* Let one capsule morph for live state.
- M 4/keep: One live-state pill that carries 'Sensors on · Stop', 'Illustrative · Reset' and the Lite message, with priority tiers. *Improve:* Make it the single aria-live announcer with rate limits, keep it out of the gutters, and enforce the 3-word cap.

<a id="r2-cross-pollination-scout-10"></a>
## Worn Bright: atoms polish where you touch them
`R2-cross-pollination-scout-10` · look · effort M · judges mean **1.8** (E2 P2 A2 Pr1 M2; park 4, kill 1) · self-scored fun 3 / visual 3 · perf neutral

> Like the snout of Florence's bronze boar, rubbed gold by millions of hands, the atoms you poke, pluck and pop pick up a warm polish in their highlights that stays. Your favourite molecules slowly show where you have played. The Daily can later show where everyone touched today.

**Framing:** problem->solution

**Builds on:** new (museum mechanism); rides C088 Daily, C027 interactions, C094 retention; pairs with Pop-It permanence

**Problem:** Nothing a visitor does in Lupi leaves a mark. A returning visitor finds the same untouched specimen, so there is no permanence, no sense of 'mine', and no quiet social trace. Every round-1 retention idea is a menu (passport, streaks) rather than something visible on the object itself.

**Solution:**

Mechanism sources:
- Statue rubbing and touch-polished bronze, where constant contact wears the patina to a golden sheen (https://en.wikipedia.org/wiki/Porcellino, https://sculpture-network.org/en/page/74466/statue-rubbing-the-ritual-of-touch).
- Vlambeer's permanence.

Design:
1. Each atom carries a 4-bit wear level (0-15). A deliberate interaction raises it by 1: tap-select, pluck, pop, lens-select, Music pad hits on that atom. Hover and orbit never do.
2. Appearance, in the R3 impostor: wear shifts only the specular highlight toward warm brass and slightly lowers roughness in the highlight lobe. Albedo, the element colour, is never touched, so identity stays truthful.
3. Visibility: a level of 15 is noticeable up close and invisible at thumbnail scale. It is off in Illustrate, the Clear Look and the V2 export.
4. Storage: local and per molecule id, as a sparse map of atomIndex to level. Up to 5k atoms fits in about 2.5 KB of base64, with an LRU of 30 molecules in localStorage.
5. Controls: 'Your polish' toggle and 'Clear polish' in Style.
6. Phase 2 (needs a cost owner): 'Everyone's polish' for the Daily only (C088).
   - The current /collectAnalytics endpoint only logs to Workers logs (verified in apps/mcp-worker/src/index.ts), so this needs real aggregation such as Workers Analytics Engine.
   - Events: anonymous {dailyId, atomIndex} counts, rate-limited per session.
   - Display: only atoms above a k-anonymity threshold of 20 touches, rendered as a separate, fainter patina.
   - It yields a curiosity line: 'Today's most-rubbed atom: caffeine's N7'.

**Experience:**

Desktop and phone: no new gesture. Polish accrues from play you already do, and returning to caffeine next week shows your warm spots. Tapping a polished atom's info tag says 'You've touched this atom 9 times'.

Keyboard: interactions through the atom cursor count the same.

Screen reader: the atom info announces 'polished by you: level 9'. A 'Your most-touched atoms' list in Learn gives the same information as text.

Reduced motion: polish is static, so there is nothing to reduce.

**Tech:**

- 4 bits of the R2 unorm8x4 fourth byte, with the other 4 bits left for hover, selected and glow flags.
- The TSL impostor specular term reads it.
- A localStorage sparse map (try/catch; renders fine when empty).
- Phase 2: Cloudflare Workers Analytics Engine or D1 counters behind the existing edge collector, PII-free and k-anonymous.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R2 (flag byte bits), R3 (impostor specular); phase 2 needs new edge storage with a cost owner

**v9 slice:** Record-only: start counting wear locally now, so the polish exists on the first day after the port, and ship the 'Your most-touched atoms' Learn list. There is no visual on v9, because a per-atom specular tweak needs the impostor rewrite. Showing wear through v9's per-atom 'property' colour mode would look like data, so it is rejected.

**WebGL2 fallback:** Identical: one attribute read in the fragment stage on both backends.

**Where in code:**

- New packages/ui/src/play/polish.ts (store and localStorage).
- R2 repack of the atom attributes (packages/scene/src/AtomsOptimized.tsx successor).
- R3 TSL impostor specular.
- Learn panel list.
- Phase 2: apps/mcp-worker/src/index.ts (the collectAnalytics neighbour) plus a new binding.

**Risks:**

- Patina could be misread as 'reactive sites'. Keep it specular-only, keep it out of analysis looks, and label it.
- It is too subtle to notice without a first-time explainer.
- Phase 2: storage cost, bot rubbing (rate limits) and privacy (k-anonymity).
- 4 bits of the flag byte are contested with other toys, so the R2 byte layout needs one owner.

**Honesty:** The label in Learn and on the atom tag reads 'Polish shows where you (or everyone) touched. It is not a property of the atom.' It is never in analysis looks or export, and 'Everyone's polish' is aggregated and anonymous.

**Judges:**

- E 2/park: It takes 4 flag-byte bits that port-05 has allocated to toy scratch, and persistent patina risks reading as 'reactive sites' (decoration posing as evidence). It is also too subtle without an explainer. *Improve:* Revisit only if the bit table has room, and keep it out of analysis Looks.
- P 2/park: Atoms polishing where you touch them is a sweet idea about permanence, but it's too subtle to notice and easy to misread as reactivity. *Improve:* Revisit after the R2 flag byte ships, as a view inside the Notebook only.
- A 2/park: Poetic, but a persistent, history-dependent change to the specimen's highlights makes caffeine look different on each visit, reads as 'reactive sites', and spends scarce flag bits. *Improve:* If it returns, show polish only on the Notebook stamps, never on the live specimen.
- Pr 1/kill: A persistent per-atom patina driven by your history could be read as reactive sites. Phase 2 needs collective storage beyond the contract's bounds. *Improve:* None. Drop it.
- M 2/park: Lens-neutral. *Improve:* Only after the core toys ship.

<a id="r2-cross-pollination-scout-11"></a>
## Crystalscaper: tap-to-build nanocrystals that decorate themselves
`R2-cross-pollination-scout-11` · toy · effort L · judges mean **3.4** (E3 P4 A4 Pr3 M3; keep 4, park 1) · self-scored fun 5 / visual 4 · perf neutral

> Townscaper for crystals. Tap a copper nanocrystal to add an atom on the nearest real lattice site, and the crystal decorates itself: {111} faces glint cool, {100} faces warm, step edges get a hairline, and every click lands with a soft clack pitched by how many neighbours the atom found. There is no goal and no failure, and a 'Wulff' button shows the equilibrium shape.

**Framing:** problem->solution

**Builds on:** C078 (growth) + C040 (derived-structure provenance) + C116 (parked: fixes 'slow to reward') + C030 condense tokens + C009 picking

**Problem:** Every crystal in Lupi arrives finished. C078 (Grow a Crystal) is passive to watch, C116 (stop-motion) was parked as slow to reward, and C040's cookie cutter is a tool. Townscaper and Tiny Glade show that building becomes a toy when every click is instantly beautiful because the system resolves the detail, and nothing can fail.

**Solution:**

Mechanism sources:
- Townscaper, a 'toy, not a game': players place blocks and an algorithm turns them into houses, arches and stairs (https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making).
- Tiny Glade's gridless 'building chemistry' with no fail state (https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games).
- Toca Boca's no-winners digital toys (https://www.killscreen.com/secret-smart-kids-entertainment-give-them-toy-not-game/).

Build mode, a Play-chip verb, on a generated fcc Cu seed of about 200 atoms:
1. Tap:
   - GPU ID pick of the tapped atom;
   - of its vacant nearest-neighbour sites (12 fcc offsets), choose the one best aligned with the tap ray's outward direction;
   - add the atom with a tiny 'condense' pop (C030 token) and a clack pitched by its coordination number (CN), where more neighbours means lower and more stable.
2. Long-press (Build mode only) removes a surface atom. Undo is Ctrl+Z or the Undo chip.
3. Self-decoration, recomputed incrementally, is geometric classification by neighbour count:
   - Surface atoms are classed by CN: 9 ≈ {111} terrace, 8 ≈ {100}, 7 or less = step, edge or corner.
   - Class shows as a rim tint on surface atoms, never albedo.
   - Floating glyph chips '{111}' and '{100}' sit at facet centroids (R8). Facet planes come from quickhull3 on the rebuilt shell, since it allocates and so is run only on settle.
   - The live readout is 'N atoms · 58% {111} · average CN 8.7'.
4. Tidy removes atoms with CN ≤ 3 in one satisfying sweep, the system beautifying the build.
5. Wulff morphs toward the equilibrium shape for the same atom count: a truncated octahedron from γ111/γ100 ≈ 0.866 (broken-bond estimate; cf. ASE's wulff_construction, https://wiki.fysik.dtu.dk/ase/ase/cluster/cluster.html). The morph uses C030's condense motif and is labelled.
6. Save as XYZ with provenance: 'derived, unrelaxed, built on an ideal fcc Cu lattice (a = 3.615 Å)'. This is C040's rule.
7. Rendering pre-allocates the instance buffer to the maximum N (e.g. 5k) and toggles a visibility bit, after Codrops' 'dragging a slider must never allocate' pattern (https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/).

**Experience:**

Desktop: click to add, Alt-click to remove, scroll to zoom and drag to orbit. Phone: tap to add. Long-press removes in Build mode, where the loupe is suspended, and the Droplet Lens is available via its chip for precision. Undo and Tidy chips sit in the thumb zone.

Keyboard: the atom cursor walks surface atoms, Enter adds at the focused atom's best vacancy, Delete removes, and T tidies.

Screen reader: 'Added atom, 9 neighbours, on a {111} terrace. 412 atoms, 58% {111} surface.'

Reduced motion: added atoms appear without the pop, and Wulff is a crossfade between two stills. Each click still gives its clack, with a caption.

**Tech:**

- Occupancy Uint8Array over an fcc site grid (e.g. 32³ cells × 4 basis sites).
- A 12-neighbour offset table with incremental CN updates in O(1) per click.
- LATTICE_BASIS (today in packages/ui/src/mcpViewerBridge.tsx; move to core).
- math@0.1.0 quickhull3 (allocates, so settle only).
- R3 GPU buffers (useBuffers) with a visibility bit.
- R8 glyph labels.
- Web Audio on the C041 bus.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (preallocated GPU buffers and visibility bit), R8 (facet labels), C009 (tap picking)

**v9 slice:** A capped prototype of about 1.5k atoms: rebuild the small structure through the existing load path per click, bonds via the worker (C010), facet readout and clack sounds. Everything is CPU and DOM with no GLSL. Labels on v9 use the existing troika text, which is throwaway, so keep them minimal.

**WebGL2 fallback:** Identical on the WebGL2 backend (small buffer updates, no compute). Low Power Mode: unaffected, since rendering is at rest between clicks.

**Where in code:**

- New packages/ui/src/play/crystalscaper.ts.
- LATTICE_BASIS from packages/ui/src/mcpViewerBridge.tsx moved to packages/core.
- packages/scene/src/SpatialHash.ts.
- Export through the existing XYZ path in packages/ui/src/ExportManager.tsx with a provenance comment line.
- Facet chips via the R8 LupiText shim.

**Risks:**

- Tap-to-site ambiguity on phones; the lens and ray-direction choice help.
- Classifying by CN is fuzzy at small sizes, so ambiguous atoms are labelled 'step'.
- Scope creep toward a materials editor; there are no goals, scores or other lattices in v1.
- Build mode must own tap and long-press.
- The Wulff morph path is not a growth mechanism, so it needs a label.

**Honesty:** Builds are 'derived, unrelaxed, on an ideal fcc lattice; real nanoparticles relax and reconstruct'. Facet names are a geometric classification by neighbour count. The Wulff shape is the equilibrium construction from cited broken-bond surface energies, and the morph to it is an illustrative path.

**Judges:**

- E 3/keep: Occupancy on a real fcc site grid with O(1) coordination-number updates and small buffer writes is cheap and at rest between clicks. The v9 prototype rebuilds per click up to ~1.5k atoms. *Improve:* Preallocate the buffer with a visibility bit after R3, and label outputs 'derived' per the Shelf.
- P 4/keep: Townscaper for crystals: each tap adds an atom and the crystal decorates itself with facet colours and a clack pitched by its neighbours. No fail state, and 30 s of poking comes easily. But it's L effort, and tapping the right site on a phone is fiddly. *Improve:* Prototype on v9 with Loupe snapping, starting from a small cuboctahedron with a 'tidy to Wulff' payoff.
- A 4/keep: Facets that decorate themselves from real coordination ({111} cool, {100} warm, hairline step edges) make a distinctive derived image with no fail state. *Improve:* Take the facet tints from a labelled derived-data token pair, and pitch the clack through joy-09.
- Pr 3/park: Townscaper for crystals is charming and the facet names are real, but it is effort L and drifts toward a materials editor. *Improve:* Revisit after the Science Shelf, reusing Grow It.
- M 3/keep: Tap-to-build is accessible, and rendering is at rest between clicks, but the effort is L. *Improve:* Add a keyboard site cursor and announced coordination numbers.

<a id="r2-cross-pollination-scout-12"></a>
## Scratch Deck: DJ a real molecular-dynamics run
`R2-cross-pollination-scout-12` · toy · effort S · judges mean **3.6** (E4 P4 A3 Pr4 M3; keep 5) · self-scored fun 4 / visual 3 · perf neutral

> For real MD runs, a turntable platter replaces the tool-like scrubber. Spin it and time follows, flick it and time coasts, or spin it backwards to watch a tungsten collision cascade un-scatter. Scratch back and forth across the impact, which shows as a spike in the run's own activity waveform printed around the platter's rim.

**Framing:** problem->solution

**Builds on:** C072 (real runs, temperature metadata) + C065 (real trails pair with scratching) + C021 (inertia and catch); gives C080 (Atom Smasher) its natural verb on sand_w_cascade

**Problem:** Lupi's most honest motion is its real trajectories (cu_melt, cu_solidify, sand_w_cascade, al_polycrystal, water), but the judges called trajectories 'niche for newcomers'. The frame slider is a tool, not a verb, and C072's thermometer only helps on the melt runs. Time is the one thing in these files you can play with without inventing anything.

**Solution:**

Mechanism sources:
- Chrome Music Lab's Voice Spinner, a turntable where direction plays forward or backward and rpm changes pitch (https://musiclab.chromeexperiments.com/Voice-Spinner).
- DJ scratching and back-spinning.
- The editing JKL shuttle convention: L forward, repeated L doubles speed, J reverse, K pause (https://www.premiumbeat.com/blog/video-editing-j-k-l-shortcuts/).

Design:
1. On trajectory files, the Deck (a DOM or SVG platter in the thumb zone) replaces the scrubber, which stays available as a list toggle.
2. Platter angle maps to frame: one revolution = F frames, auto-chosen so a typical run spans 3-6 turns.
3. Drag spins it 1:1. Release keeps C021-style inertia on a math spring, and a tap catches it. Playback steps are real frames only; the existing fractional interpolation (useSmoothFramePlayback) is labelled 'smoothed between frames' when active.
4. Waveform rim: the loader computes per-frame activity, the mean squared displacement from the previous frame, as real measured data. It is drawn around the rim like a DJ waveform, so the cascade's impact is a visible spike you can drop the needle on.
5. Sound, optional on the C041 bus: a soft vinyl-like tone whose playback rate and direction follow the platter, as in Voice Spinner. On runs with temperature metadata (C072), pitch follows temperature, so the melt 'sounds hotter'.
6. Reverse: spinning backward shows 'Time reversed' in the Status Island.
7. Coalesce frame uploads to one per rAF and skip intermediate frames at high scratch speeds, so 30k-atom runs stay responsive.

**Experience:**

Desktop: drag the platter or use the mouse wheel over it. JKL is the full keyboard deck:
- J reverses, L plays forward, and repeated presses double speed up to the existing 16× cap (PlaybackSpeedControl 0.0625-16).
- K pauses; K+J and K+L step single frames.
- These keys are free in useGlobalShortcuts.

Phone: a thumb spins the platter, and a flick sends time coasting. The platter is DOM, so Android vibrates at waveform peaks crossed while scratching (throttled); iOS gets sound only.

Screen reader: 'Frame 412 of 1000, 1358 K, melting, playing forward 2×' (temperature where the metadata has it). The waveform peak is announced as 'highest activity at frame 188'.

Reduced motion: the platter doesn't spin visually. JKL and step buttons give one still per step, and the waveform stays static.

**Tech:**

- DOM or SVG platter with pointer capture.
- math@0.1.0 spring.update and dampAngle for inertia.
- The existing setFrame/nextFrame/prevFrame, PlaybackSpeedControl and useSmoothFramePlayback.
- Per-frame activity computed in the trajectory worker or loader.
- Web Audio playbackRate on a short looped buffer (C041 bus).
- JKL in useGlobalShortcuts.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (ships on v9); R7 later aligns audio and frame jobs on one clock

**v9 slice:** All of it: the platter, JKL, the waveform rim and the time-reversed label on today's playback store and scrubber.

**WebGL2 fallback:** Not applicable (DOM plus the existing frame upload path). Low Power Mode: the frame coalescing already covers 30 Hz.

**Where in code:**

- New packages/ui/src/app/ScratchDeck.tsx beside packages/ui/src/app/PlaybackScrubber.tsx and PlaybackSpeedControl.tsx.
- packages/ui/src/hooks/useSmoothFramePlayback.ts.
- JKL in packages/ui/src/app/useGlobalShortcuts.ts.
- Activity computation in the trajectory loader or worker.
- Temperature via C072 metadata.

**Risks:**

- Scratching large runs means heavy frame uploads, so coalescing is mandatory and must be tested at 30k atoms.
- Reversed time might be read as 'atoms can go backwards'; hence the label.
- Sound default.
- The waveform metric must be defined and documented, or it looks like arbitrary decoration.

**Honesty:** Only real recorded frames are shown, and smoothing between frames is labelled when active. 'Time reversed: this is the recording run backwards, not something atoms do.' The waveform is a stated measurement: mean squared displacement per frame. Export is untouched.

**Judges:**

- E 4/keep: A DOM platter over existing playback, JKL keys and an activity waveform. Small and v9, it makes real runs playful. Frame-upload coalescing at 30k atoms is mandatory. *Improve:* Test scratching at 30k atoms and keep the 'time reversed' label in the Status capsule.
- P 4/keep: A DJ platter that scratches real MD time, where spinning back un-scatters a cascade, turns a tool into a toy. S effort, on v9, but only for trajectories. *Improve:* Showcase one hero trajectory in the gallery so strangers find it, and add a scratch sound.
- A 3/keep: The activity waveform printed on the rim is good data-viz. The platter itself is a skeuomorph. *Improve:* Draw a flat ink platter in the tokens.
- Pr 4/keep: It makes existing real MD runs, inspecting trajectories being an owned outcome, playable. It is small and ships on v9, with a 'time reversed' label. *Improve:* Ship it on cu_melt with JKL keys.
- M 3/keep: The JKL shuttle is familiar, and the scrubber stays available. *Improve:* Scope the keys per PE-04, and label reversed time in text.

<a id="r2-cross-pollination-scout-13"></a>
## Juice Pass: hit-stop, trauma camera and anticipation, within a motion-sickness budget
`R2-cross-pollination-scout-13` · system · effort S · judges mean **3.2** (E3 P5 A3 Pr2 M3; champion 1, keep 2, rework 1, park 1) · self-scored fun 4 / visual 3 · perf neutral

> Add the three game-feel tricks springs can't provide to the motion kernel. A 40-80 ms 'sleep' makes impacts land heavy, a trauma-squared noise shake capped at half a degree adds weight, and a 90 ms wind-up precedes each big release. They are camera-only, with hard vestibular caps and zero under reduced motion.

**Framing:** problem->solution

**Builds on:** C003 (motion tokens) + C041 (cue bus) + the flash-guard and motion-sickness-budget gaps from D2

**Problem:** Round 1's feel system (C003) is springs and settle times. Springs make motion smooth, but they can't make an impact feel heavy. The burst clicking back together, the last pop, a kaleidoscope snap, a Dzhanibekov flip and a finished crystal facet all land flat. The obvious fix, screen shake, is the mobile-accessibility judge's biggest fear, and round 1 proposed no motion-sickness budget at all.

**Solution:**

Mechanism sources:
- Vlambeer's 'The Art of Screenshake': sleep (hit-stop), camera kick, permanence (https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/).
- Squirrel Eiserloh's GDC 2016 'Juicing Your Cameras With Math': shake = trauma², rotational only in 3D, driven by smooth noise rather than random numbers, with trauma decaying over time (http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf).
- 'Juice it or lose it' (Jonasson and Purho).

Spec, one table beside C003's motion tokens:
1. The juice event bus is shared with C041's sound cues, so sound, hit-stop and shake always coincide. Each event carries {hitStopMs, trauma, kickDeg, anticipationMs, cue}. Examples:
   - burst.reassembled {60, 0.35, 0, 90, chord}
   - pop.boardCleared {80, 0.4, 0, 0, chord}
   - kaleido.snap {50, 0.2, 0, 0, chime}
   - weightless.flip {40, 0.15, 0, 0, clunk}
   - flick.release {0, 0, 0.2, 0, whoosh}
2. Hit-stop: the fun-layer clock (deformer t) and camera springs pause for hitStopMs. Input is buffered and applied after the stop, never dropped. It only fires on discrete impact events, never during a drag or coast.
3. Trauma camera:
   - trauma += event.trauma, clamped to 1, decaying at 1.5/s.
   - Shake rotation = maxDeg · trauma² · simplex3d(seed, t·8 Hz) per axis (yaw, pitch, roll) with math/noise, applied as a post-multiplied quaternion so it never accumulates into the orbit state.
4. Hard caps (the motion-sickness budget):
   - maxDeg 0.5 on desktop and 0.3 on phones;
   - at most 300 ms of shake per event and 1 s per 10 s;
   - never while a finger is down;
   - never translational;
   - 0 under prefers-reduced-motion and when the 'Calm camera' setting is on;
   - hit-stop only in Low Power Mode.
5. Camera kick: 0.2° recoil opposite the flick direction on release, springing back on the 'snap' token.
6. Anticipation: scripted releases (burst, roll, re-inflate, Wulff) start with a 90 ms counter-motion, a spring launched with negative initial velocity (math spring.update).
7. Tests: a unit test asserts zero shake under reduced motion and the budget caps; a CI check ensures no event exceeds the table.

**Experience:**

Desktop and phone: impacts feel weighty (a split-second freeze, a tiny settle wobble, a sound on the same beat) without ever moving the view far. Nothing changes during direct manipulation.

Keyboard: key-triggered events juice identically, under the same caps.

Screen reader: juice is non-semantic, so nothing is announced beyond each event's own caption.

Reduced motion: hit-stop stays (it removes motion rather than adding it), and trauma, kick and anticipation are 0.

A 'Calm camera' switch in settings also zeroes them without reducing other motion.

**Tech:**

- math@0.1.0 simplex3d (math/noise), seeded via mulberry32 so shakes replay identically in Instant Replay, plus spring.update and quat multiply.
- @pmndrs/scheduler: a 'fun clock' job that can pause without pausing input, applied in the 'finish' phase to the camera quaternion only.
- A matchMedia prefers-reduced-motion listener.

**Backend:** DOM/CPU (camera and clocks only)

**Rides (v10 requirements):** none (ships on v9 with C003); R7 phases after the port

**v9 slice:** All of it: the camera post-multiply and clock pause in today's CameraManager and CameraFocus, plus the event table.

**WebGL2 fallback:** Not applicable: it is camera and clock only. Low Power Mode: hit-stop only.

**Where in code:**

- New packages/ui/src/motion/juice.ts beside C003's kernel.
- packages/ui/src/app/CameraManager.tsx and packages/ui/src/CameraFocus.tsx for the shake post-multiply.
- The event bus shared with lib/sound.
- Settings toggle in the Style or Settings panel.

**Risks:**

- Over-juicing cheapens the specimen brand, so the art director owns the table.
- Hit-stop misused on continuous motion reads as a hitch, hence the discrete-events-only rule.
- Shake during capture must be excluded: the capture service zeroes trauma.
- Vestibular sensitivity varies, so 'Calm camera' must be one tap away and remembered.

**Honesty:** Camera and timing only; atoms never move, and deterministic export and every capture zero the trauma. Juice never accompanies a data change (loading, analysis results), only play events, so it can't dramatise evidence.

**Judges:**

- E 3/keep: Hit-stop and anticipation on the analytic clock are cheap. Trauma camera shake, even at 0.5°, is camera motion that conflicts with play-10's comfort rule. *Improve:* Ship hit-stop and anticipation; keep shake off by default and out of capture.
- P 5/champion: Hit-stop, a trauma-squared micro-shake and anticipation are the game-feel tricks springs can't provide. Camera-only, capped, zero under reduced motion, S effort on v9, and every toy gets weightier. *Improve:* The art director owns the event table, and juice applies only to discrete events: detent lock, pop, burst, catch.
- A 3/rework: Anticipation and hit-stop are timing principles that serve the springs. A trauma shake on a specimen is a game trope, even capped at 0.3°. *Improve:* Keep anticipation and hit-stop. Drop the trauma shake and the camera kick.
- Pr 2/park: Camera shake contradicts the Comfort Budget, and heavy 'juice' cheapens the specimen brand. *Improve:* Salvage hit-stop into the motion tokens.
- M 3/keep: The best-capped juice: 0.3° on phones, never while a finger is down, zero under reduced motion, hit-stop only in LPM. Still, it adds net camera motion. *Improve:* Tie it to PE-10's setting, with Gentle meaning hit-stop only.

<a id="r2-cross-pollination-scout-14"></a>
## Chladni Dust: sprinkle sand on a real vibration and watch the nodes appear
`R2-cross-pollination-scout-14` · moonshot · effort L · judges mean **2.8** (E2 P3 A4 Pr3 M2; keep 2, merge 1, park 2) · self-scored fun 4 / visual 5 · perf costs

> Like sand on a violin-bowed Chladni plate: tap Dust, then play one of the molecule's real vibrations. Glittering grains get kicked off the atoms that move most and pile up on the ones that stay still, so the mode's nodal pattern draws itself across a graphene ribbon or around C60.

**Framing:** capability->problem

**Builds on:** C073 (baked modes and manifest) + C067/C037 particle lineage (but bounded and honest); real twin built in via the amplitude map (D5)

**Problem:** C073 bakes real normal modes (per-atom displacement vectors, with a versioned manifest), and v10's TSL compute can run tens of thousands of particles on the viewer's own device. Yet a mode animation is hard to read: the eye can't tell which atoms stay still, and the nodal structure, which is the point of a mode, is invisible. The Chladni plate is one of the oldest science-museum demonstrations because sand makes nodes visible.

**Solution:**

Mechanism sources: the Chladni plate, where sand is thrown off antinodes and collects on nodal lines, and its web versions (https://github.com/schroffl/chladni-simulation, https://physandbox.com/waves/chladni-plate, https://www.comsol.com/model/chladni-plate-67591).

Design:
1. Dust is a toy on molecules with baked modes (C073's 10-20 heroes; graphene_ribbon and C60 first).
2. Setup:
   - 20k-50k decorative grains on WebGPU (fewer on the fallback) settle onto the molecule. Each belongs to an atom and sits on that atom's display sphere at a random direction.
   - Per atom, a precomputed neighbour list with 6-12 fixed slots comes from SpatialHash.
   - Per atom, the real amplitude |u_i| of the chosen mode comes from its mode vector, normalised.
3. Play a mode by tapping Pluck, or pick one from the mode list with its real frequency. Each grain then:
   - accumulates kick energy e += k·|u_atom|·(noise) per step;
   - when e passes a threshold, hops to a random neighbour atom, with the hop biased toward lower amplitude, and resets e;
   - otherwise jitters on its sphere.
   Grains drain from antinodes and pool on low-amplitude atoms, drawing the nodal pattern: bands on the ribbon, belts on C60.
4. The mode ring lasts about 3 s, then grains settle and the loop sleeps (onIdle).
5. Grains render as tiny instanced sprites (WebGPU points are 1 px) and sparkle only by pixel-radius fade, with no flashing.
6. 'Clear dust' is one tap.
7. Honest core: a toggle 'show the real amplitude' recolours atoms by |u_i| through the existing per-atom property colour map. This is the ground truth the dust is illustrating.

**Experience:**

Desktop: click Dust, then pick a mode ('ring mode 3, 1580 cm⁻¹') and watch the pattern form; drag to orbit. Phone: the Dust chip plus a mode stepper in the thumb zone. It is bounded (about 3 s of work, then sleep), and particle count is set by the device tier.

Keyboard: D toggles dust, [ and ] step modes, and Enter plays.

Screen reader: 'Mode 3, 1580 wavenumbers. Dust gathered on 14 atoms that barely move: the ring's carbon pairs 2-3 and 5-6.' The atoms are named from the real amplitude ranking, not from the particles.

Reduced motion: skip the dust and show the real-amplitude colour map as one still per mode step.

**Tech:**

- TSL compute: instancedArray (useBuffers, @react-three/tsl canary) holding grains {atomIndex u32, octDir, energy}, plus buffers for the atom neighbour table and per-atom amplitude.
- An integer-hash RNG in-shader; no atomics are needed because each grain updates only itself.
- Instanced sprites for rendering.
- Scheduler: a per-job fps of 30 on phones, then onIdle.
- Mode vectors from C073's offline manifest.
- The existing 'property' colour scheme ('Map the colorway onto a loaded per-atom scalar', packages/ui/src/coloring/colorSchemes.ts) for the amplitude map.

**Backend:** [GPU] (full dust); [GL2-degraded] (fewer grains via transform feedback); amplitude map [GPU+GL2]

**Rides (v10 requirements):** R3 (GPU buffers on the viewer device), R6 (sprite pass and MRT sparkle), C073's baked-mode pipeline

**v9 slice:** The honest core only: once C073's modes are baked, show a mode's real amplitude as a per-atom property colour map through v9's existing 'property' scheme, with a legend. No particles and no GLSL.

**WebGL2 fallback:** The kernel is simple and per-grain (no atomics, no workgroup memory), so it can run as transform-feedback compute with about 5k grains. Where that is slow, or on old iPhones in Low Power Mode, it shows the amplitude colour map instead: a still, honest and cheap.

**Where in code:**

- New packages/ui/src/play/chladni.ts (TSL kernel module) and mode manifest loading beside C073.
- Neighbour lists from packages/scene/src/SpatialHash.ts.
- Amplitude map via packages/ui/src/coloring/colorSchemes.ts 'property' mode and PropertyLegendHUD.tsx.

**Risks:**

- Depends on C073's baked modes existing, with provenance.
- iPhone WebGPU limits for storage buffers in the vertex stage are unverified (fact sheet open question), so sprites may need to read positions through attributes.
- Grains could be read as matter (electrons or solvent) — C059's kill reason — so the label and the 'real amplitude' toggle must sit side by side.
- Fill rate on phones, so cap sprite size and count.

**Honesty:** 'Dust is decoration that shows where the real vibration doesn't move.' The amplitude per atom is real, from the cited baked mode with method and version, and a toggle shows it directly as a colour map. Grains never touch coordinates and never reach export.

**Judges:**

- E 2/park: WebGPU compute particles (20-50k grains) with a GL2 transform-feedback degrade is L effort. It depends on C073 bakes and the unverified iPhone limits. Its honest core, a mode-amplitude colour map, is cheap. *Improve:* Salvage the v9 amplitude colour map into real-05 now; revisit the dust after the gate spike.
- P 3/keep: Sand drawing a real mode's nodal pattern is beautiful and honest, but it's late ([GPU], L) and depends on baked modes. *Improve:* Make it an extension of Mode Harp, with the v9 amplitude colour map first.
- A 4/keep: Sand drawing a real mode's nodal pattern is one of the most elegant science images available, with the amplitude map as its honest core. 'Glittering' grains are a sparkle trope. *Improve:* Matte grains in one ink or plate-contrast colour, with no sparkle. Keep it [GPU], with a stated grain count on the WebGL2 fallback.
- Pr 3/merge: Merge into R2-real-twins-science-05. The honest amplitude map is useful now; the dust is [GPU] and effort L. *Improve:* Ship the amplitude map now and add the dust later.
- M 2/park: [GPU], with about 5k grains on GL2, sparkle and 'perf costs'. *Improve:* Revisit after the device lab reports.
