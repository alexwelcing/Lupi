# Wave 1: the Buckyball Minute, status

Wave 1 is the first change a visitor can feel. The R3F v10 port ([port-status.md](port-status.md)) was plumbing. The plan is `final.md` in the wave's working notes, and the owner's overrides were: audio and haptics off by default, one pill, no toy motion in any artifact, and it has to work on WebGPU and WebGL2, on desktop and phone.

## What shipped for a visitor

- **Home page (`/`).** A still, grey ink C60 sits beside the H1. It is SVG, with zero canvases and no idle motion or sound. A drag spins it 1:1. On release it coasts, clicks onto a hexagon or pentagon face, and names the face. On a phone a vertical swipe still scrolls the page, and the search box stays above the fold. C60 is first on the molecule wall.
- **Opening a molecule.**
  - A tap on the drawing, a wall tile or a search result goes straight to 3D on sage, with no dark frame. The drawing grows to fill the window and can still be spun while the viewer loads.
  - The lit cage takes over at the same pose. Behind the hero, the flat drawing inflates into depth. Other first opens condense bottom-up out of a seeded mist in 0.6 s.
  - Any touch lands the arrival instantly.
  - Deep links (`/?sim=…`) open on a sage "Opening…" plate and never show the home heading.
- **Camera: the Lupi rig replaces OrbitControls.**
  - A drag follows the pointer 1:1.
  - A flick coasts on the molecule's real inertia and clicks into a face-on view. The pill briefly names it ("Pentagon face-on · 5-fold axis").
  - A tap during a coast stops it dead ("Caught").
  - The wheel zooms toward the cursor, and pinch zooms toward the fingers. Two fingers pan, and a lime ring marks each finger.
  - Presets and Recenter glide. The arrow keys hop between symmetric views, and Home returns to the opening view.
  - `?controls=orbit` brings the old controls back.
- **Atoms.**
  - A tap opens the atom's card and never moves the camera. On desktop the card sits beside the atom, not over it.
  - The tap also sends a 0.3 Å ripple through the cage, with the bonds attached. The pill then reads "Illustrative · Reset". The first time in a session it spells it out: "Illustrative motion, your atoms haven't moved".
  - A double-tap glides to the atom. A double-tap on empty space zooms toward that point.
- **One Play pill** (bottom-left on desktop, one row above the deck on a phone). It carries the status and the old Clear view stow. It replaces both the Clear view bucket and the gesture hint. On a first visit it teaches "Drag to spin · Tap an atom", from the first frame until the first gesture, the first atom tap, or 10 s.
- **The Play tray.** The pill, `P`, a right click on the canvas, or the palette's "Open Play" opens it. It holds:
  - One finger: Orbit / Poke. With Poke latched, one finger stirs ripples.
  - Scatter.
  - Spin. Caffeine flips end over end: "Flip! · tennis-racket effect".
  - Reset.
  - Motion: Standard / Gentle / Still.
  - Settings….
- **Settings.** A "Sound and motion" group sits at the top of Settings:
  - Sound, off by default.
  - Haptics, off by default. It is offered only where a vibration can be felt.
  - Motion.
- **Honesty.** Exports, MCP artifacts, thumbnails and video never contain toy motion. An export taken mid-ripple has the digest of one taken at rest. Saved views and share URLs hold the settled, level pose.

## Tuning points (current values, for owner feedback)

| Where | Value | File |
|---|---|---|
| Drag | π rad per canvas height (1:1) | `ui/src/camera/rigController.ts` |
| Flick detection | window 80 ms, pause 60 ms, minimum 0.5 rad/s, maximum 6π rad/s | `ui/src/camera/gestureTokens.ts` |
| Tap slop | mouse 3 px, touch and pen 8 px; double-tap 300 ms and 32 px | `gestureTokens.ts` |
| Isotropic coast | τ 1.2 s, plus 1.5 rad/s² friction (a 3 rad/s flick settles in about 1.2 s, a 10 rad/s flick in about 2.3 s) | `ui/src/camera/isotropicCoast.ts` |
| True Spin coast | on-axis τ 1.2 s, off-axis τ 0.35 s (the major-axis rule), 1.5 rad/s² friction, inertia floored at 2 % of the largest moment | `ui/src/camera/trueSpinCoast.ts` |
| Spin (tray) | 3 rad/s about the middle axis, 5 % wobble, held 4 s, then τ 1.5 s | `trueSpinCoast.ts` |
| Coast end | below 0.3 rad/s the rig lands the coast itself (at most 0.3 s); it counts as "moving" (a tap catches) above 0.3 rad/s | `rigController.ts` |
| Righting | a slowing coast rolls back toward y-up below 1.5 rad/s | `rigController.ts` |
| Detent capture | faces caught below 1.5 rad/s. The landing takes 2θ/v, clamped to 0.25–0.9 s, overshoots at most 2°, and a face needing a brake of more than 0.3 rad/s is skipped | `rigController.ts` |
| Capture cone | at most 24° (C60: 24°); 12° when the faces are too sparse to cover the sphere (caffeine) | `core/src/objectFacts/detents.ts` |
| Face flash | 1.2 s ("Caught" 0.7 s, "Flip!" 1.8 s) | `ui/src/camera/CameraToys.tsx`, `LupiCameraRig.tsx` |
| Arrow-key hop without detents | 15° | `CameraToys.tsx` |
| Wheel zoom | eased over about 0.06 s; may stretch 8 % past the limits and spring back (user zoom only) | `rigController.ts` |
| Double-tap on empty space | distance × 0.6 toward the point | `scene/src/AtomPicker.tsx` |
| Arrival | 0.6 s (Gentle 0.3 s at half travel), cloud 1.6 × the radius, 0.2 s bottom-up stagger; at most 20,000 atoms, single frame, once per molecule per session | `ui/src/play/PlayLayer.tsx`, `arrivalRules.ts`, `scene/src/tsl/displayMotion.ts` |
| Ripple | 0.3 Å (the hard bound; Gentle 0.15, Still 0) at 20 Å/s, ω 36 rad/s, ζ 0.28, 8 Å falloff; Poke strokes 0.2 Å | `displayMotion.ts`, `PlayLayer.tsx` |
| Scatter | 0.18 s rise, then the condense | `displayMotion.ts` |
| Pill | each text shows at least 1 s; ripple and scatter labels hold 1.5 s; the teaching line lasts 10 s; Poke unlatches after 30 s idle | `ui/src/play/PlayPill.tsx` |
| Hero | detents are faces within 12° of the turntable (8 faces, largest gap 70°); it opens at 16.8° across, 17.9° up | `ui/src/landing/hero/buckyStage.ts` |
| Relay | the hand-off waits up to 1.5 s for the bonds under the relay; the ring appears after 1.2 s; a baton spin above 0.5 rad/s carries into 3D | `ui/src/relay/FirstFrameSignal.tsx`, `stage.ts` |
| Sound and haptics | both off by default; ticks of 6 ms (detent, catch), 12 ms (flip) and 8 ms (reset), at most 10 a second; clicks under 35 ms apart merge | `ui/src/play/feedback.ts`, `ui/src/lib/haptics.ts` |

## Known limits

- **Only checked on SwiftShader.** Every check ran on software WebGPU and WebGL2 at 1 to 10 frames a second. The motion is right, but smoothness on real phones and GPUs has not been judged.
- **Bonds can arrive after the atoms.** On SwiftShader the bonds come 1.8 s (WebGL2) to about 10 s (WebGPU GPU bond pass) after the atoms. So the hand-off and the arrival there show bare spheres first, and ball-and-stick appears later. On real hardware they should land inside the 1.5 s wait. This has not been measured.
- **Some overlays do not follow display motion.** Labels, selection rings, glyphs, clusters and trails stay at rest positions during an arrival, ripple or scatter (at most 0.6 s for an arrival).
- **The desktop card can cover part of a small molecule** above or below the atom.
- **Rate limit on flashes.** The pill shows each text for at least 1 s. A flash shorter than that ("Caught" is 0.7 s) can be swallowed if another text appeared just before it.
- **The camera rig is new code** in front of every gesture. Safari trackpad pinch, Magic Mouse, iOS pointer capture and Android have not been tried on devices. `?controls=orbit` is the escape hatch.
- **Deep links** can briefly show the viewer header over the "Opening…" plate.
- **MCP `lupi.export_asset` fits the camera by default.** For molecules under 5,000 atoms it moves the live camera to its front fit unless `fitCamera: false`, and it boosts the atom scale for molecules under 200 atoms. This predates wave 1.
- **Ripples are off under the transmission (glass) renderer.** Its atoms have no offset graph, so the bonds would move without them.
- **Three-fold axes** through the face centres of ring-less shapes (SF6-like) are not detected, and relaxed conformers may fall back to "Ring face-on" at 0.05 Å.

## Wave-2 queue

- Real-device pass: iPhone Safari, Android Chrome, a mid-range laptop GPU. Retune the coast, capture and ripple values from the table above.
- ~~Quiet Idle (demand frames)~~: built in wave 2 (the viewer renders on demand; see AGENTS.md, "Quiet Idle").
- Upright detent roll and FOV narrowing (this needs an up/roll field in the store, saved views, URLs and artifact specs).
- The rest of Object Facts: hull, rest faces, dice, a libmsym bake, and worker facts for large files.
- The rest of the gesture constitution: long-press loupe and tray, twist-to-roll, two-finger trackpad orbit, a left-handed mirror, cooperative gestures for embeds.
- More verbs (Knife, Lasso, Tug, Wake, Burst, Heat), a hover glow, and GPU ID picking.
- Overlays that follow display motion (labels, selection rings, glyphs).
- Side placement of the desktop atom card.
- A live, spinnable relay for tiles and finder rows, and View Transitions.
- Mode Harp and sound beyond the one click; share loops (Instant Replay, Unfurl cards, Remix codes); the mastery layer (detent combos, the Notebook axis map).

## Where the proof lives

- **Smoke plugins** (local only, not CI) in `tools/smoke/scenarios/`: `camera`, `chrome`, `first-minute`, `flick`, `hero`, `relay`, `settings`, `tap` and `toys`. `first-minute` walks the whole path on one page: still `/`, hero drag onto a face, the relay tap with no dark frame, the hero pose and the flat inflate, a flick onto a named face, a catch, an atom tap with its ripple, card and "Illustrative", Reset, and an MCP PNG equal to the rest export.
- **Unit tests** (small, for the tricky pure functions): `core/motion`, `core/objectFacts`, `trueSpin` + `symmetryDetents`, `rigController`, `gestureArbiter`, `displayMotion`, `arrivalRules` and `captureGuards`.
