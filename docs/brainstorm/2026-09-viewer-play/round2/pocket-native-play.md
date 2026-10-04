# Round 2 · Pocket Play, Built for a Phone in One Hand

[← all round-2 ideas](README.md)

## Direction notes

Direction D6, Pocket Play: 14 ideas. The core is 1 layout foundation, 3 phone-native systems (loupe, haptics, sensors), 5 toys and games that are v9-shippable and camera- or DOM-only, 3 pocket-reality foundations (cadence, memory, data), the Expo channel, and a flagship that ties them into context decks.

Key decisions and tensions resolved:
1) iOS haptics. C041 assumed drag-tied ticks, but iOS 26.5 allows haptics only on direct switch taps. So every moment worth feeling gets a tap-shaped twin (flippers for flicks, detent chips for coasts, steppers for scrubbers, buzzers, shutter, Ping). Drag ticks move to Android vibrate and to a whitelisted Expo cue bridge. Nothing is conveyed by haptics alone.
2) Physics toys without moving atoms. Flipper Spin, Plumb Line and Symmetry Snap do rigid-body rotation as camera motion. The lights and backdrop follow the camera during the toy, and AtomsOptimized already transforms world-fixed light directions into view space in JS each frame. So they ship on v9 with zero GLSL, AtomPicker's world-space picking and export stay untouched, and 'source atoms never move' holds structurally. The fun is grounded in real data: masses from packages/core elements.ts, the inertia tensor (tennis-racket flip for asymmetric tops), and centre of mass via plumb lines.
3) The old-iPhone double penalty. A rAF probe that renders nothing separates a Low Power Mode cap (33.3 ms with low jitter) from a slow GPU. Capped phones keep direct manipulation continuous and switch toys to art-directed held-pose flip-books on C027's closed-form deformers and C055's on-twos look, plus a turn-based deck. This answers the mobile judge's objection to C004. The Expo shell supplies the real Low Power Mode flag.
4) Phone realities research confirmed:
- iPhone Safari exposes no Save-Data or navigator.connection, hence an explicit Data saver switch and shell-injected network signals.
- iPhone has no orientation lock or element fullscreen, so sideways is treated as posture-as-intent, with a portrait Camera chip fallback.
- The iOS WebContent kill threshold is not a fixed number, hence a lower-bound ledger calibrated by C014, background hygiene and a crash-aware reload into 'safe pocket'.
- The Expo app already has expo-haptics, a WebView bridge, native Room AR and termination recovery; its TestFlight gate is blocked only by ascAppId; and it has no associatedDomains.
5) The loupe rework follows the judges exactly. It magnifies the already-rendered colour target in an output-pass TSL node (TextureNode.sample and PassNode.getTextureNode were checked in the r186 build) and snaps via C009's ID patch. It renders one crisp crop only when the finger pauses, uses a rim instead of a radius swell, and shares long-press with tug through a movement threshold.
6) Pass-and-play and the tabletop duel fill the local-multiplayer gap without infrastructure. Hide an Atom teaches bond topology and is fully playable by screen reader through bond-graph navigation. Symmetry Snap turns four curated observation prompts (water, benzene, C60, nanotube) into a game that corrects the projection illusion.

Deliberately left out:
- Two-phone 'flick to a friend' (needs rooms; C115 is parked).
- Always-on gyro parallax (a vestibular risk; the tilt window stays opt-in at 3° and off under reduced motion).
- Drag-tied haptics on iOS web.
- App Clips and a native renderer fork. *Amended 2026-10-04: native rendering is now in scope as a separate app, `apps/apple` (SwiftUI + RealityKit), per the owner's [AR decisions](../../../ar/decisions.md) and the [plan of record](../../../ar/plan.md). App Clips stay out.*
- WebXR (frozen until R10).
- Anything on `/` (zero canvases respected).
- Any FPS numbers. The 33.3 ms figure is a detection signature, not a performance claim.

Unverified, needing device tests:
- persistence of the switch-haptic trick and whether it survives Low Power Mode;
- requestPermission inside a switch change handler;
- drawImage cost from a WebGL canvas on iOS (the v9 loupe slice);
- WebGPU inside WKWebView on iOS 26;
- Resource Timing transferSize on Safari;
- openchemlib's shipped chunk size;
- the WebGL2-backend render-target readback used by the shutter.

Cross-direction dependencies:
- D2: gesture grammar, atom cursor, flash guard, sensors-on rule.
- D3: lazy toy registry with byte declarations, device-loss recovery, per-atom byte budget.
- D4: capture service for shutter, cards and clips.
- D7: secrets meter stamps for the first tennis-racket flip.

Sources:
- https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/
- https://github.com/m1ckc3s/project-fathom
- https://haptics-web.vercel.app/
- https://bugs.webkit.org/show_bug.cgi?id=168837
- https://birchtree.me/blog/how-to-enable-120hz-mode-in-safari-mac-iphone-and-ipad/
- https://caniuse.com/netinfo
- https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- https://developer.apple.com/forums/thread/771787
- https://github.com/expo/expo/blob/main/packages/expo-battery/src/Battery.ts
- https://docs.expo.dev/versions/latest/sdk/netinfo/
- https://en.wikipedia.org/wiki/Tennis_racket_theorem

<a id="r2-pocket-native-play-01"></a>
## Thumb Arc: a one-thumb reach map with the molecule framed above your thumb
`R2-pocket-native-play-01` · foundation · effort M · judges mean **3.8** (E4 P3 A4 Pr3 M5; keep 5) · self-scored fun 3 / visual 3 · perf improves

> Every verb lives in a bottom Rail inside the holding thumb's arc. The top band becomes read-only, the molecule is framed where the thumb isn't, and sheets carry the scene instead of resizing the canvas.

**Framing:** problem->solution

**Builds on:** C026 + C023 (answers the playtester's 'polish, not play' by making C026 the layout system; hosts the C021/C041 chips; rehomes C024's atom-card dock)

**Problem:** Today's phone chrome puts controls in the hardest band to reach. The camera-view selector and Controls launcher sit at safe-area + 108 px. The atom card docks under the header at calc(76px + safe-area-top), with its 44 px close button up there. Opening the Style sheet changes the canvas rectangle, so CameraManager refits (C026's bug). In Hoober's field study, 49% of people held the phone one-handed and worked it with the thumb. On a 6.1-6.9 inch phone the top third is the 'ouch' zone. The molecule is also framed at the geometric centre, which is exactly where a right thumb lands while playing.

**Solution:**

1) Reach map in portrait. The Rail is the bottom ~200 CSS px above the home indicator and holds every verb. The Stage is the middle and takes direct manipulation only. The Crown is the top ~25% and is read-only: name, formula, atom-card content and the 'illustrative motion' status. Rule: on phones, nothing is operable only from the Crown except the conventional top-left Back. The D2 Play/reset chip lives in the Rail; only its status shows in the Crown.
2) The Rail is the existing persistent tab bar (Play / Controls / Atoms / Search) plus an arc of at most four context chips on the dominant side: camera detents, the Play chip, one-tap Reset and Shutter. Chips are at least 48 px and grow toward the screen edge, where touch accuracy falls off. The atom card keeps its content in the Crown. To dismiss it, tap empty Stage, swipe it up, or tap an x chip in the Rail.
3) Handedness. The layout starts centred. A ~40-line classifier fits circles to the first ten one-finger drags (a right thumb pivots at the bottom right, so its arcs curve around that point) and looks at where touches start. When confident, it offers 'Move controls to your right thumb?' once. There is also a Settings toggle. The choice is stored in localStorage (wrapped in try/catch) and never sent anywhere.
4) Optical centre. On phones, setViewOffset puts the fit target about 42% from the top. Readouts that follow the finger (rev/s, loupe, labels) appear on the side away from the hand.
5) Sheets carry the scene (extends C026). The sheet has three detents: Peek (Rail chips plus the handle), Half and Full. The view offset follows the sheet's drag progress 1:1. The camera distance springs so the molecule's bounding sphere fits the remaining Stage, down to a 'specimen strip' above a Full sheet, so Style edits preview live instead of hiding the molecule. visualViewport changes (the Search keyboard, the URL bar) use the same offset, never a canvas resize.
6) Landscape splits the Rail into two edge columns (see Sideways Is a Camera).
7) Inside the Expo shell, the native control bar is the Rail and the web Rail hides.
Reduced motion: offsets and refits jump straight to their end state. Deterministic export is untouched, because this is camera framing only.

**Experience:** Phone, one hand, on a train: every chip is under the thumb and the molecule floats above it. Opening Style slides a card up while the molecule glides into the strip above it. Desktop: unchanged, except that side panels use the same view-offset shift. Keyboard: DOM order runs Crown, Stage, Rail, and F6 cycles the regions. Screen reader: landmarks are header (Crown), main (Stage, carrying D2's atom cursor) and nav (Rail). The handedness offer is an ordinary dialog.

**Tech:** CSS env(safe-area-inset-*) and dvh units; visualViewport resize events; PerspectiveCamera.setViewOffset / clearViewOffset (three r184 and r186); math@0.1.0 spring.update driven by the sheet's drag progress (pre-1.0); PointerEvent.getCoalescedEvents (feature-detected) for the arc fit; an algebraic (Kasa) circle fit; localStorage. Reach research: https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/

**Backend:** DOM/CPU

**Rides (v10 requirements):** none. Verify under R6: ID picking and pipeline passes with a view offset (C026's test). R7 for demand frames during sheet drags.

**v9 slice:** All of it: move the launchers into the Rail, apply the Crown rule, view-offset framing, sheet detents on C026, and the handedness offer. No renderer code.

**WebGL2 fallback:** Identical on the WebGL2 backend (camera projection only). Low Power Mode: sheet drags invalidate frames only while the sheet moves; the offset spring settles, the loop sleeps, and nothing ambient runs.

**Where in code:** packages/ui/src/ViewerApp.tsx (mobile layout; timeline dock calc(64px + env(safe-area-inset-bottom))); packages/ui/src/controls.tsx (MobileTabButton); packages/ui/src/AtomInfoHUD.tsx (MOBILE_DOCK_TOP and its close target); packages/ui/src/app/CameraManager.tsx (styleLayoutChanged refit); packages/ui/src/hooks/useMediaQuery.ts; MOBILE_VIEWER_RELEASE_NOTES.md (launchers at safe-area + 108 px, sheet clamp heights)

**Risks:** Existing users lose their muscle memory. Handedness can be misclassified, which is why the layout offers and never forces. iPad and foldables need a width breakpoint. Pick coordinates must be remapped under setViewOffset. The Expo shell would show two rails if the web Rail isn't hidden there.

**Honesty:** Layout and camera framing only. No change to data, picking semantics or deterministic export.

**Judges:**

- E 4/keep: Turning C026 into the phone layout system (Rail, Stage, Crown) with setViewOffset framing needs no renderer code on v9. Picking and the ID patch must be remapped under the view offset. *Improve:* Add a Playwright test that picks under setViewOffset in both R11 lanes, and invalidate only while a sheet moves.
- P 3/keep: Putting every verb in the thumb arc and framing the molecule above the thumb makes one-hand play possible. A foundation, not a toy. *Improve:* Add a hard chrome budget (a maximum number of pills and chips) shared with the Play chip.
- A 4/keep: Framing the molecule above the thumb with a view offset is composition for phones, and the Crown/Rail split keeps chrome off the specimen. *Improve:* Hero poses and detents must respect the offset frame. Add phone-aspect framing to sig-10's goldens.
- Pr 3/keep: A sound reach-map layout system for phones, but it moves every launcher, costs existing users their habits, and must fit the contract's list of viewer controls. *Improve:* Land it after the Play chip amendment, as one PR alongside C026.
- M 5/keep: A reach map with a read-only Crown and a Rail in the thumb arc, plus sheets that carry the scene instead of resizing the canvas, fixes a shipping bug and is the right one-thumb layout. v9, no renderer code. *Improve:* Add an iPad and foldable breakpoint, and a chrome priority map, so the Play chip, Status Island, flippers, 'Hear it', Replay and the shutter never compete for the same arc.

<a id="r2-pocket-native-play-02"></a>
## Loupe 2.0: magnify the frame you already have, sharpen it when you pause
`R2-pocket-native-play-02` · system · effort M · judges mean **4.0** (E4 P4 A4 Pr4 M4; keep 5) · self-scored fun 3 / visual 4 · perf improves

> Hold still on the molecule and a glass bubble magnifies the already-rendered frame above your thumb. Its crosshair snaps to the atom that owns the ID patch, one crisp crop renders when you pause, and lifting your finger selects.

**Framing:** problem->solution

**Builds on:** C024 (reworked under the engineer's and art director's conditions) + C009's ID patch; enables C091 on phones

**Problem:** A fingertip covers about 10 mm, while atoms in a 50k lattice are a few pixels wide. AtomPicker ray-marches in 0.5 Å steps, allocates a Vector3 per step and forgives 15 px, so a tap in a dense scene can silently select a neighbour. Round-1 C024 re-rendered a crop continuously, repeating all the vertex work at 1M+ atoms, and swelled radii under the cursor, which the art director rejected because radii are data. C091's hunts and Hide an Atom both need a finger-accurate select.

**Solution:**

1) Hold still for 300 ms (less than 8 px of movement) on the Stage. A 104 px bubble appears 96 px from the finger, on the side away from the hand (Thumb Arc), with a pop on a C003 snap token.
2) While you slide, the bubble shows the current frame at 2.5x. On v10 this is a TSL node in the output pass that samples scenePass.getTextureNode('output').sample(loupeUV) inside a circle, with a brand rim and a crosshair. The scene is not re-rendered: each finger move costs one composite frame on demand.
3) Snap. The crosshair locks to the atom with the most pixels in a 24x24 patch of C009's RGBA8 ID target, read with readRenderTargetPixelsAsync, one read in flight at a time. The snapped atom gets a light rim through the R2 flag byte, never a change of radius.
4) Pause for 150 ms and one crisp render covers only the loupe crop: setViewOffset into a ~260 px render target, one frame, then sleep. This resolves sub-pixel atoms that the main frame culled. It is skipped on phones above ~1M atoms and in pocket-stills (Stop-Motion Pocket); there the bubble stays magnified with a SharpenNode.
5) Lifting selects. The bubble collapses into the atom card, which offers Pin / Hide / Measure-from-here chips (Haptic Moments). Slide to a screen edge or flick away to cancel; a second finger cancels and becomes a pinch.
6) The readout under the crosshair is DOM text: symbol, name, index and bonded neighbours.
Gesture arbitration: holding still for 300 ms opens the loupe; moving before 300 ms orbits. A Play-chip verb that owns long-press (C031's tug) takes precedence. The canvas gets -webkit-touch-callout:none and user-select:none, and the context menu is prevented.
Reduced motion: no pop; the bubble just appears, and its position doesn't spring.

**Experience:** Phone: press, slide, and the crosshair clicks from atom to atom. Android vibrates 4 ms per snap, the Expo shell ticks natively, and iOS web plays a soft click. Lift and the atom is selected. Desktop: off by default; Alt+hover shows the same bubble for dense lattices, and hover stays C009's rim. Keyboard and screen reader: D2's atom cursor is the equivalent, and an option makes the bubble follow the focused atom. The atom under the crosshair is announced in a polite aria-live region, throttled to 500 ms.

**Tech:** three r186 TSL: PassNode.getTextureNode('output'), TextureNode.sample(uv), screenUV plus length() for the circle mask, SharpenNode. WebGPURenderer.readRenderTargetPixelsAsync(rt, x, y, w, h, textureIndex), present in the r186 build. setViewOffset plus useRenderTarget (core in the R3F v10 canary) for the one-frame crisp crop. math@0.1.0 spring2 for the bubble follow (pre-1.0). navigator.vibrate. v9: one reused 2D canvas fed by drawImage(glCanvas crop), which works because ViewerCanvas sets preserveDrawingBuffer: true.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R6 (ID MRT and output pass), R3/R2 (flag-byte rim), R7

**v9 slice:** A DOM bubble drawn by drawImage from the preserveDrawingBuffer canvas. It uses one small, reused 2D canvas to stay well clear of iOS canvas-memory limits. Snapping goes through the existing AtomPicker at rAF rate, with the DOM readout and the Pin chip. No new GLSL. Measure drawImage cost on an iPhone first; if it stalls, ship the crosshair and readout without magnification.

**WebGL2 fallback:** The composite is a fullscreen UV remap and the ID patch is RGBA8; both are expected to work on the WebGL2 backend (C009). Low Power Mode: the bubble redraws only when the finger moves; the crisp crop stays at one frame per pause at most, and pocket-stills skips it.

**Where in code:** packages/scene/src/AtomPicker.tsx (0.5 Å march, 15 px soft hit, window pointerdown/mousemove listeners); packages/scene/src/SpatialHash.ts; packages/ui/src/viewer/ViewerCanvas.tsx (preserveDrawingBuffer: true); packages/ui/src/AtomInfoHUD.tsx (the card it collapses into); packages/ui/src/app/ViewerScene.tsx:680 (AtomPicker mount)

**Risks:** Magnified pixels are soft at the phone DPR cap of 1.25; the pause render answers this. drawImage from a WebGL canvas on iOS may force a synchronous readback. The async ID read lands a frame late, so a fast finger can outrun the snap. Long-press competes with iOS system gestures. Patch coordinates must account for the Thumb Arc view offset.

**Honesty:** The loupe shows pixels already rendered, plus a rim highlight. Atom radii and positions never change, and nothing here enters any export.

**Judges:**

- E 4/keep: The v9 slice (drawImage from the preserveDrawingBuffer canvas into one small 2D canvas) works today. The v10 claim that each finger move costs one composite without re-rendering the scene is wrong as written: I checked that PassNode's updateBeforeType is FRAME, so any pipeline render re-renders the scene pass. It hosts cross-08. *Improve:* At hold start, snapshot the output into a texture. While sliding, render only a loupe overlay quad (a separate small render with autoClear off). Render the crisp crop once on pause.
- P 4/keep: Finger-accurate selection is the prerequisite for every atom-specific toy on a phone (Hide an Atom, pluck, pop), and a bubble that snaps is itself satisfying. *Improve:* Host Droplet Lens's refractive rim as a skin, and arbitrate hold-to-loupe against tug and hang through the Gesture Constitution.
- A 4/keep: Magnifying the frame already rendered, sharpening on pause, with a brand rim and crosshair, keeps the loupe a clear instrument. *Improve:* Host cross-08. Snap feedback uses the single hover signature, with no refraction.
- Pr 4/keep: A finger-accurate select is a prerequisite for phone hunts, Hide an Atom and the lantern. The v9 DOM-bubble slice ships now. It hosts cross-08. *Improve:* Test on iOS whether drawImage from a WebGL canvas forces a synchronous readback, and keep liquid-glass styling optional.
- M 4/keep: Host for CP-08. It magnifies the already-rendered frame (no re-render, so no thermal spike), sharpens on pause and selects on lift: a finger-accurate select for tremor and small targets. *Improve:* Use no pop animation under reduced motion, announce the snapped atom, and cap the v9 drawImage path, which may force a synchronous readback on iOS.

<a id="r2-pocket-native-play-03"></a>
## Haptic Moments: design the taps worth feeling on iOS 26.5
`R2-pocket-native-play-03` · system · effort S · judges mean **3.2** (E3 P4 A2 Pr3 M4; keep 5) · self-scored fun 3 / visual 2 · perf neutral

> Since iOS 26.5 only a direct tap on a switch buzzes. So every moment worth feeling becomes a tap-shaped DOM control, drag-tied ticks go to Android and the app shell, and nothing is conveyed by haptics alone.

**Framing:** problem->solution

**Builds on:** C041 (corrects its iOS assumption) + C099's salvaged DOM-flipper lesson + C021 detents

**Problem:** C041 promised detent, limit and swipe ticks. But library authors report that iOS 26.5 closed every programmatic path: only a direct finger tap on an <input type='checkbox' switch> fires the Taptic Engine. Continuous play (flick, coast, loupe slide) is exactly where iOS web cannot tick. packages/ui has no haptics at all today.

**Solution:**

1) A moment inventory, with a channel per platform.
- Direct taps get an iOS web tick, an 8-12 ms Android vibrate, and expo-haptics in the app. These are: detent chips (Top, Side, Iso, Face); the Flipper Spin flippers; +/- steppers for trajectory frames, C072 temperature and loupe zoom; the Symmetry Snap buzzers; the Sideways shutter; Hide / Ready / Ping in Hide an Atom; Pin on the loupe; the C062 Remix roll; the C088 Daily answer; and real toggles (Motion, Sound, Haptics, the Play chip).
- Drag moments (a coast crossing a detent, the rubber-band limit, a loupe snap, a flick release) get a 4 ms Android vibrate and the Expo cue bridge (Lupi Pocket). On iOS web they get a C041 sound cue and a visible pulse, and no haptic is promised.
2) Tap-shaped twins. Wherever the fun is continuous, add a tap version so iPhone users can feel it: flippers for flicks, detent chips for coast-to-detent, steppers for scrubbers.
3) A <HapticTap kind='tick|thunk|success'> component, using the ios-haptics / @haptics technique. The visible control sits inside a <label> whose hidden <input type='checkbox' switch> takes the tap and toggles on every press. For non-toggle buttons, the label gets role='button' and the input gets aria-hidden and tabindex=-1, so assistive tech sees a plain button; Enter and Space activate it without the switch. The overlay is installed only on iOS Safari 17.4+, where switch exists. Elsewhere it is a plain button plus navigator.vibrate. Carry ios-haptics' fix so a scroll that starts on a chip still scrolls.
4) Rules: one haptic per tap and none on scroll; Android patterns never exceed 3 pulses per second; a global Haptics switch (iOS also obeys the system setting); every haptic is paired with a visible state change, so no information is haptic-only.
5) A hidden /#/haptics-lab route lists every moment for a device matrix (iOS 17.4-26.4, iOS 26.5+, Android Chrome, Expo). It settles open question 9 in the fact sheet.

**Experience:** iPhone: chips, flippers and steppers click under the thumb like hardware. Android: the same, plus light ticks during drags. Desktop: no haptics; the same controls with hover and focus. Keyboard: every moment is a button or a switch. Reduced motion: haptics aren't motion, so they stay, but press animations become instant.

**Tech:** <input type='checkbox' switch> (Safari 17.4+). ios-haptics 3.2.0 and @haptics/vanilla as reference implementations, or a ~40-line in-house component. navigator.vibrate. C041 cue-bus event names. CSS linear() easing for press springs: Safari keeps rAF at 60 Hz on ProMotion by default, while CSS animations may run faster (verify per device). Sources, all library-author claims rather than WebKit primary sources: https://github.com/m1ckc3s/project-fathom, https://haptics-web.vercel.app/, https://github.com/tijnjh/ios-haptics/pull/12

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it, including the haptics-lab route.

**WebGL2 fallback:** Not renderer-dependent. Low Power Mode doesn't affect DOM taps, but verify on a device whether iOS suppresses switch haptics in Low Power Mode.

**Where in code:** packages/ui/src/controls.tsx (MobileTabButton); packages/ui/src/studio/primitives.tsx; packages/ui/src/app/PlaybackSpeedControl.tsx; new packages/ui/src/haptics/HapticTap.tsx; apps/mobile/src/features/viewer/viewer-control-bar.tsx (already calls Haptics.selectionAsync)

**Risks:** The switch side effect is undocumented, and Apple has already narrowed it once. An invisible overlay can steal drags that start on a chip. VoiceOver semantics of a label-wrapped hidden switch need testing. Some users turn haptics off.

**Honesty:** Haptics carry feel, never data. A haptic never replaces a measurement or a correctness signal; there is always a visible equivalent.

**Judges:**

- E 3/keep: Designing tap-shaped DOM moments around iOS 26.5's switch-only haptics is correct. Nothing relies on haptics alone. The switch trick is undocumented and could be narrowed again. *Improve:* Build a haptics-lab route and verify on devices before any UI depends on it.
- P 4/keep: Designing tap-shaped moments that actually buzz on iPhone is real juice work, grounded in the iOS 26.5 limitation. Unverified on devices. *Improve:* Run a device haptics lab first. The design must still work if the switch trick fails, so every moment also carries sound and a visual.
- A 2/keep: Outside my lens. *Improve:* Detent chips should look like the tray chips.
- Pr 3/keep: The principle is right: design tap-shaped moments and never rely on haptics alone. But the design rests on an undocumented iOS side effect that Apple has already narrowed once. *Improve:* Test on devices before any design depends on it.
- M 4/keep: Honest about iOS 26.5: library authors report that only direct taps on switch overlays still buzz, and nothing is conveyed by haptics alone. *Improve:* Device-test LPM suppression and VoiceOver semantics of label-wrapped hidden switches, add a Haptics off toggle, and make sure the overlays never steal drags.

<a id="r2-pocket-native-play-04"></a>
## Flipper Spin: drum the molecule with its real inertia, then toss it into a tennis-racket flip
`R2-pocket-native-play-04` · toy · effort M · judges mean **3.4** (E4 P4 A3 Pr3 M3; keep 2, merge 3) · self-scored fun 5 / visual 3 · perf neutral

> Each tap on the two thumb flippers clicks with a real iOS haptic and kicks the molecule's spin, which responds with its true mass distribution. Toss an asymmetric molecule about its middle axis and it flips over like a spinning racket.

**Framing:** problem->solution

**Builds on:** C021 + C041 + C099 (salvaged flippers) + C032 (salvaged rigid bounce)

**Problem:** Flicking (C021) is the first fidget, but on an iPhone it can't be felt. Every molecule also spins with the same weightless feel, even though masses and shapes differ enormously. Round 1 left two salvaged scraps without a home: C099's DOM flippers, one of the few verbs that get iOS haptics, and C032's rigid bounce, salvaged as a C021 easter egg.

**Solution:**

1) Flippers. Two large Haptic Moment buttons sit at the Rail's bottom corners in two-thumb portrait, and in the edge columns in landscape. One-thumb mode shows one flipper plus a Catch chip. Each tap adds an angular impulse about the screen's vertical axis, left or right. Holding both flippers catches the spin.
2) Real response. The inertia tensor comes from element masses (packages/core elements.ts) and positions about the centre of mass. A 3x3 Jacobi eigen-solve gives the principal moments I1 <= I2 <= I3 and their axes. Angular velocity is I^-1 L, so C60 or a tungsten complex spins up slowly and methane zips.
3) Torque-free rigid-body motion. Euler's equations in the body frame, integrated with RK4 on a hand-written fixed-step accumulator in the scheduler's physics phase (scheduler 0.2.0 has no fixed step). Gentle dissipation guarantees it settles. Below a threshold, C021's detent spring takes over, with a click cue.
4) The Toss: both flippers together, or T. It launches a spin about the intermediate principal axis. Asymmetric tops (water, caffeine, aspirin) flip periodically, the tennis-racket (Dzhanibekov) effect. Symmetric tops (benzene, methane, C60) don't, and the caption says why. The first flip stamps D7's secrets meter.
5) Rendering is camera motion. The body rotation is applied inversely to the camera about the centre of mass. During the toy, the key, fill and rim light directions and the backdrop follow the camera, so it reads as the object spinning under fixed studio lights. (AtomsOptimized's useFrame already transforms world-fixed light directions into view space in JS.) Atom data, AtomPicker's world positions and export are untouched.
6) Mastery: a quiet, opt-in peak rev/s record, as in C021.
Reduced motion: each flipper tap rotates one 30° detent step as a still, and the flip becomes a before/after pair of stills with a caption.

**Experience:** Phone: thumbs drum the flippers, each tap clicks, and the molecule answers with weight. Toss water and watch it tumble over and back. Desktop: on-screen flippers by mouse, or the Z and X keys; flicks still work. Keyboard: Z/X for the flippers, T to toss, Space to catch. Screen reader: 'Spin left' and 'Spin right' buttons, with a polite live region reading '1.3 turns per second' and 'flipped over'.

**Tech:** math@0.1.0 quat (setAxisAngle, multiply, normalize), vec3, mat3, and spring.dampAngle for the detent handoff (pre-1.0). math has no eigen solver, so a hand-written Jacobi (~60 lines). Euler's rigid-body equations with RK4. The @pmndrs/scheduler physics phase (0.2.0, pre-1.0), or a v9 useFrame accumulator. three scene.backgroundRotation / environmentRotation for the v10 node path (present in the r186 WebGPU build). Physics: https://en.wikipedia.org/wiki/Tennis_racket_theorem

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for demand frames). On v10 the TSL impostor must apply an env-rotation uniform itself for the desktop IBL tiers.

**v9 slice:** Everything: flippers, the rotor, and camera-equivalent rendering with JS-side light directions following the camera. On desktop IBL tiers the PMREM reflection drifts slightly until v10.

**WebGL2 fallback:** Identical on the WebGL2 backend, since these are camera-only renders. Low Power Mode: higher dissipation keeps coasts short, and each tap still answers at once. The flip plays at display cadence as a camera render, or as two stills in pocket-stills.

**Where in code:** packages/scene/src/AtomsOptimized.tsx:1553-1563 (lightWorldDirs into view space); packages/core/src/elements.ts (mass); packages/ui/src/app/CameraManager.tsx; packages/ui/src/lib/spring.ts (to be replaced by math/time); new packages/ui/src/toys/rigidRotor.ts

**Risks:** Flippers take Rail space: show them in Play mode or once the molecule is spinning. The camera equivalence needs the backdrop to follow, or the gradient tilts. Periodic crystals have no meaningful rigid rotor, so limit this to finite molecules and compute inertia in a worker above ~50k atoms. Degenerate eigenvalues need tie handling. Fast tumbles need C003's angular-velocity cap for comfort.

**Honesty:** Labelled 'illustrative spin, real masses': a classical tabletop analogy, since real molecular rotation is quantised. Only the view rotates; coordinates never change and export is unaffected.

**Judges:**

- E 4/merge: Merge into R2-joy-and-mastery-03. Flippers as direct DOM taps are a good True Spin input, since they get iOS haptics. On IBL tiers a camera-equivalent rotation needs an environment rotation uniform, which sig-02's mat3 provides. *Improve:* Make the flippers an input mode of True Spin.
- P 4/keep: Drumming flippers that click on iPhone, with the molecule answering on its real inertia, is a lovely phone-native input, and the only way iOS gets a haptic spin. Tossing it into a racket flip is the showstopper. *Improve:* Share the rotor with True Spin, and show the flippers only in Play or once the molecule is spinning.
- A 3/merge: Host: R2-joy-and-mastery-03. The flippers are chrome over the specimen, and the rigid-body model is the same one as joy-03 and cross-03. It does get one thing right: highlights must stay world-fixed while the molecule turns. *Improve:* Make the flippers an input to True Spin, shown only while the molecule is spinning.
- Pr 3/merge: Merge into R2-joy-and-mastery-03. It is the same real-inertia physics as True Spin. The flippers are a Haptic Moment control on top of it. *Improve:* Offer the flippers as True Spin's optional controls.
- M 3/keep: Flipper taps are legitimate iOS haptics, with Z/X keys and reduced-motion stills, but it duplicates JM-03's rotor and assumes two thumbs. *Improve:* Share JM-03's physics, give the one-thumb layout one flipper, and inherit PE-10's angular-speed cap.

<a id="r2-pocket-native-play-05"></a>
## The Motion Switch: one real switch asks for sensors, shows they're on, and clicks
`R2-pocket-native-play-05` · system · effort S · judges mean **3.4** (E4 P3 A3 Pr3 M4; keep 3, merge 2) · self-scored fun 3 / visual 2 · perf improves

> A native iOS switch labelled Motion is at once the permission gesture, the haptic, the accessible control and the 'sensors on' indicator. It feeds one sensor bus that detaches itself when idle, and a thumb stand-in exists for every shake and tilt.

**Framing:** problem->solution

**Builds on:** C028 + C042/C043 + C025 + C067 + C062. This is the shared flow the mobile judge asked for; it generalises snow-motion.ts out of GPU Studio.

**Problem:** Shake and tilt toys keep multiplying: C028's wobble, C042/C043's snow, C025's tilt window, C067's slosh, C062's shake-to-remix and Plumb Line's hanging. Each wants DeviceMotion or DeviceOrientation, and iOS requires requestPermission from a gesture. Listeners drain the battery if left on. Gyro parallax is a vestibular trigger. And desktop players, people who deny permission and devices without sensors should get the same fun. The only permission flow today lives inside GPU Studio (snow-motion.ts).

**Solution:**

1) The control is a real <input type='checkbox' switch> labelled Motion, in the Rail's overflow and in the Play menu. One tap does four jobs:
- it is the explicit gesture that calls DeviceMotionEvent.requestPermission() and DeviceOrientationEvent.requestPermission() synchronously in the handler, before any await (enablePhoneSnow's rule);
- it fires the iOS switch haptic;
- it is natively role=switch;
- while on, together with a small static sensor glyph in the Crown, it is D2's visible 'sensors on' indicator.
2) One sensor bus replaces per-toy listeners. It publishes a low-passed gravity vector in screen coordinates (rotated by screen.orientation.angle, as snow-motion.ts already does), shake impulses from the existing detector (acceleration delta > 1.2, 50 ms throttle), and an 'at rest' flag. Subscribers: C028 wobble, C042 snow, Plumb Line gravity, C025's tilt window (camera, 3° maximum), C067 slosh, and C062 shake-to-remix. A shake only offers a Remix chip; it never applies a remix by itself.
3) Battery. Listeners attach only while a subscriber is mounted and the page is visible. After 20 s at rest, or 60 s with no subscriber, they detach and the Crown says 'Motion paused, tap to resume', and that tap is a new gesture. No background sampling, no storage, and no sensor values in analytics.
4) Stand-ins are always present when Motion is off, and on desktop. A Shake button (a Haptic Moment) fires one impulse per tap, and taps accumulate. A 64 px Tilt pad in the Rail writes the same gravity vector when dragged and springs back to level on release. Switch-access users get eight direction buttons around the pad.
5) Comfort. Tilt-driven camera motion is off under prefers-reduced-motion. Shake amplitudes are clamped. Glitter passes D2's flash guard.
Reduced motion: a shake produces one still of the settled result, and tilt produces one still per 5° step.

**Experience:** Phone: flip Motion on (it clicks), shake, and snow swirls in C042's globe; tilt, and the hung molecule swings. If permission is denied or unsupported, the switch explains and points to the Shake button. Desktop: stand-ins only, with S to shake and Shift+arrows to tilt. Screen reader: 'Motion, switch, off'; the status line announces 'Motion paused' when it detaches.

**Tech:** DeviceMotionEvent / DeviceOrientationEvent.requestPermission (iOS 13+, secure context, user activation). screen.orientation.angle. math@0.1.0 spring2.damp as the low-pass (pre-1.0). An AbortController lifecycle, as in enablePhoneSnow. v10: a scheduler input-phase job writes the uGravity and uShake mood-bus uniforms through useUniforms (R3F v10 canary / @react-three/tsl canary). v9: plain JS state.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none; each subscriber rides its own requirement (e.g. C028 on R3)

**v9 slice:** The switch, the bus, the stand-ins and auto-detach, with the v9 subscribers C062 shake-to-remix, C025's tilt window and Plumb Line.

**WebGL2 fallback:** Sensors are DOM, and each subscriber declares its own WebGL2 path (C043 falls back to sprite flakes without piling). Low Power Mode: subscribers invalidate frames only for changes above a threshold, so the loop still sleeps. In pocket-stills, tilt parallax is off and shakes answer with held poses.

**Where in code:** packages/ui/src/gpu-studio/snow-motion.ts (enablePhoneSnow, SnowMotion); packages/ui/src/gpu-studio/GpuStudioLaunch.tsx:89; new packages/ui/src/sensors/motionBus.ts

**Risks:** Two things need device tests: whether requestPermission keeps transient activation inside a switch's change handler, and how long iOS remembers the grant. Some Android phones lack a gyroscope. Walking causes accidental shakes, so use a stronger threshold when the Pocket Context Deck thinks you're commuting.

**Honesty:** Responses are display-only and labelled illustrative. Sensor readings are never stored or sent.

**Judges:**

- E 4/merge: Merge into R2-play-for-everyone-08. A native <input switch> that is at once the permission gesture, the haptic, role=switch and the 'sensors on' indicator is elegant. Transient activation inside a change handler needs a device test. *Improve:* Make this switch the SensorHub's single door.
- P 3/keep: One real switch that is at once the permission gesture, the haptic, the accessible control and the 'sensors on' indicator is elegant. But strangers rarely use sensors. *Improve:* Host One Sensor Door, and offer the switch inline only from shake-worthy toys.
- A 3/keep: One native switch that is the permission gesture, the haptic and the indicator at once. That is minimal chrome. *Improve:* Host play-08. Draw the sensor glyph in the Crown in token colours.
- Pr 3/keep: One native switch is at once the permission gesture, the haptic, the 'sensors on' indicator and a role=switch control. It is small, and the safety rule requires it. It hosts play-08. *Improve:* Verify on a device that the switch's change handler keeps transient activation.
- M 4/merge: Merge into PE-08. Using one native switch as the permission gesture, the haptic, role=switch and the indicator is clever, but it duplicates PE-08's hub. *Improve:* Become PE-08's door control, and device-test that requestPermission keeps transient activation in a change handler.

<a id="r2-pocket-native-play-06"></a>
## Plumb Line: hang the molecule from any atom like a mobile
`R2-pocket-native-play-06` · science-toy · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 3, merge 2) · self-scored fun 4 / visual 3 · perf neutral

> Pick an atom and the molecule dangles from it, swinging with its real masses until its centre of mass settles straight below. Hang it from a second atom and the two plumb lines cross at the balance point; tilt the phone and it re-hangs.

**Framing:** capability->problem

**Builds on:** New. Uses C021's kernel for the handoff, makes C025's tilt honest, runs on the Motion Switch bus, and shares its rotor code with Flipper Spin.

**Problem:** Capability: Lupi knows every atom's element (and so its mass) and position, the phone knows which way is down, and a rigid pendulum is cheap to simulate. The problems this solves: the centre of mass is invisible and abstract; the bromine end of a molecule feels no heavier than the hydrogen end; and phone tilt has no honest, calm use beyond parallax.

**Solution:**

1) Tap Hang (a Play-verb chip), then tap an atom or select one with the Loupe; that atom is the pivot. The molecule hangs from it as a rigid-body pendulum. The inertia tensor is taken about the pivot (parallel-axis theorem, real masses). Gravity points screen-down, or along the device gravity from the Motion Switch bus. The swing is damped and integrated with a hand-written fixed step in the physics phase. A settle test on angle and angular speed ends it, and the loop sleeps.
2) A thin plumb line drops from the pivot through the centre of mass, drawn in the molecule's own frame.
3) Hang from a second atom. The molecule swings to its new rest, and the first line, carried with the body, crosses the new one at the centre of mass. A marker labelled 'balance point' appears, with the computed centre of mass as the check.
4) Heavy atoms show themselves: 'the bromine end hangs lowest'.
5) With Motion on, tilting re-hangs the molecule like a Calder mobile. Stand-ins: the Tilt pad, or a tap on a Nudge flipper.
6) It renders as camera motion about the pivot, with lights and backdrop following the camera as in Flipper Spin. Atoms, picking and export are untouched.
Reduced motion: no swing; the settled pose appears as a still with its plumb line. Keyboard: H hangs at the focused atom (D2's atom cursor), arrows nudge, Esc releases.

**Experience:** Phone: pick an oxygen and watch caffeine dangle; tilt the phone and it swings back; add a second pivot and the lines cross at the balance point. Desktop: click to hang and use the arrow keys to nudge; dragging on empty space leaves Hang and orbits. Screen reader: 'Hanging from oxygen 3. The centre of mass is 1.8 Å below, toward the bromine.'

**Tech:** Masses from packages/core elements.ts. Inertia tensor plus the parallel-axis theorem. math@0.1.0 quat/vec3/mat3 (pre-1.0). A hand-written damped rigid-pendulum integrator on a fixed-step accumulator (scheduler 0.2.0 has none). An SVG overlay projected on demand frames, or a three Line in the scene. An R8 glyph label for the balance point on v10.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for demand frames; R8 for an in-scene label)

**v9 slice:** All of it on v9: camera motion, JS light directions and SVG plumb lines.

**WebGL2 fallback:** Identical on the WebGL2 backend. Low Power Mode: pocket-stills shows three held poses of the swing and then the rest pose. The balance-point reveal is a still either way.

**Where in code:** packages/core/src/elements.ts; packages/scene/src/AtomsOptimized.tsx (JS light directions); packages/ui/src/app/CameraManager.tsx; packages/ui/src/gpu-studio/snow-motion.ts (gravity source, to generalise); new packages/ui/src/toys/plumbLine.ts

**Risks:** Swinging views can disorient, so cap angular velocity and damp strongly. Periodic crystals have no finite centre of mass to hang from, so limit this to molecules and clusters. Large molecules need the inertia computed in a worker. Choosing a pivot in dense structures needs the Loupe.

**Honesty:** Labelled 'illustrative swing, real atomic masses, classical rigid body'. The balance point is computed from the displayed coordinates. Only the view moves.

**Judges:**

- E 3/merge: Merge into R2-joy-and-mastery-03. It uses the same rigid-body core (inertia via the parallel-axis theorem, a hand-written fixed-step accumulator), so it is one more mode of that engine rather than a separate system. *Improve:* Ship it as a 'Hang' mode of the True Spin rotor, limited to molecules and clusters.
- P 3/keep: Hanging a molecule like a mobile is charming, honest physics, and two plumb lines crossing at the balance point is a nice aha. Low urgency. *Improve:* Absorb Weightless's hang mode, and make it a Secret Pack entry reached by long-press in Play.
- A 3/keep: A hairline plumb line crossing at the centre of mass is an elegant diagram, but swinging views need strong damping. *Improve:* Swing the object under the world-fixed rig rather than moving the camera, and cap angular speed with play-10.
- Pr 3/merge: Merge into R2-joy-and-mastery-03. It is the same rigid-body family as True Spin and Weightless, and centre of mass isn't in the curated prompts. *Improve:* Make it a True Spin variant.
- M 3/keep: Reduced-motion still, keyboard H and optional sensors, but a swinging view disorients. *Improve:* Damp heavily under PE-10 caps, give the balance point in text, and use three held poses in LPM as stated.

<a id="r2-pocket-native-play-07"></a>
## Hide an Atom: pass-and-play hide-and-seek along the bonds
`R2-pocket-native-play-07` · game · effort M · judges mean **3.6** (E4 P4 A2 Pr4 M4; keep 5) · self-scored fun 5 / visual 2 · perf improves

> One player hides a secret atom and a privacy curtain covers the screen while the phone changes hands. The seeker pings atoms to learn how many bonds away the secret is, until the shortest bond path lights up.

**Framing:** problem->solution

**Builds on:** C115 (salvaged pass-and-play) + C091 + C009/C024 (finger-accurate select)

**Problem:** Phones get passed around on couches, in classrooms and in queues, but Lupi has no way to play together. C115's co-view rooms were parked as XL infrastructure, with the explicit salvage 'start with pass-and-play on one device'. C091's hunts are solo and timed, and frustrating with fingers.

**Solution:**

1) Hide. From the Play menu, choose a curated molecule with bonds (caffeine, glucose, aspirin; C60 for experts). Select an atom by tap or with the Loupe, then press Hide here (a Haptic Moment).
2) Curtain. An opaque full-screen DOM card says 'Pass the phone to the seeker'. Nothing is rendered underneath, and the hidden atom is never highlighted anywhere. The seeker taps I'm ready.
3) Seek. Aim by tap or Loupe, then press Ping (a Haptic Moment, so iOS clicks). Lupi answers with the bond-hop distance from the pinged atom to the secret, found by breadth-first search on the bond graph: '3 bonds away, warmer'. The pinged atom keeps a static ring coloured on a colour-blind-safe ramp, plus the word. With sound on, the pitch rises as you close in.
4) Found. The shortest bond path from the first ping lights up ('O to C to C to N'). The number of pings is the score.
5) Swap roles; best of three. Two to four players are 'Player 1-4', with no names stored. An optional spoiler-free card, 'Found in 4 pings on caffeine', goes through D4's capture service.
Variants: Hide an element (the only clue is the element); Two secrets; and for crystals without bonds, the distance in Å from displayed coordinates, rounded to 0.5 Å. A seeded solo mode is where C091's hunts begin. All wording comes from a preset vocabulary, so no free text ever enters a URL (the product judge's concern about C091).
Reduced motion: rings and the path reveal are stills.

**Experience:** Couch: hide, hand over, ping, groan at '5 bonds away', find it. Desktop: hot-seat with a mouse, identical. Keyboard and screen reader: D2's atom cursor walks the bond graph (arrows move to the next bonded neighbour) and P pings. VoiceOver hears 'Carbon 4, bonded to N3, C5 and O9. Ping: 2 bonds away, warmer.' The game is turn-based throughout and fully playable without sight.

**Tech:** bondTopology (worker) converted to a CSR adjacency; breadth-first hop distance in O(N+E); mulberry32 from math/random for the seeded solo mode (pre-1.0); a DOM curtain; C009's ID pick on v10 or AtomPicker on v9; the ring via the R2 flag byte on v10 or the existing selection highlight on v9; C041 cues.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R2 flag byte and R6 ID pick on v10)

**v9 slice:** All of it, using the tap picker, the selection highlight and the CPU bond topology that already ship.

**WebGL2 fallback:** Identical on the WebGL2 backend. On Low Power Mode and old iPhones it is the ideal pocket-stills game: one still per ping and no continuous frames.

**Where in code:** packages/scene/src/bondTopology.ts, bondWorker.ts and AtomPicker.tsx; packages/ui/src/AtomInfoHUD.tsx; packages/ui/src/gallery/studentCollection.ts (curated molecules)

**Risks:** Inferred bonds can differ from the textbook drawing, so the path reveal says 'Lupi's inferred bonds'. Peeking during the hand-over: the curtain comes up before anything else, and the hide confirmation disappears. Hop counts grow large in big molecules, so curate to under ~1k atoms. Pinging in dense regions needs the Loupe.

**Honesty:** Hop distance follows Lupi's inferred bond topology and says so. Distances in Å are measured from displayed coordinates. No atom moves.

**Judges:**

- E 4/keep: BFS hop distance on the existing CPU topology, a DOM curtain and one still per ping: it ships on v9 and is the ideal game for Low Power Mode and GL2. Real social play at almost zero cost. *Improve:* Label paths as 'Lupi's inferred bonds' and use the loupe for accurate pings.
- P 4/keep: Real couch multiplayer that is molecule-native: hide, pass, ping, groan at '5 bonds away'. Turn-based, runs on old phones, fully accessible. *Improve:* It needs Loupe 2.0 for fair taps. Add a seeded solo mode with a par score so it works alone.
- A 2/keep: Visually light, and fine. *Improve:* Make the privacy curtain a designed sig-08 plate rather than a grey card.
- Pr 4/keep: Local pass-and-play that teaches bond topology, ships on v9 at zero GPU cost, and suits classrooms and phones in Low Power Mode. It labels bonds as inferred. *Improve:* Ship it before Symmetry Snap, as the first social toy.
- M 4/keep: Turn-based with one still per ping, ideal for LPM and old iPhones. Hop distance as text makes it playable through the atom cursor. *Improve:* Make the curtain an announced focus trap, and add a screen-reader mode that never speaks or highlights the secret.

<a id="r2-pocket-native-play-08"></a>
## Symmetry Snap: a tabletop duel for seeing shape
`R2-pocket-native-play-08` · game · effort M · judges mean **3.2** (E3 P4 A3 Pr3 M3; keep 5) · self-scored fun 5 / visual 3 · perf neutral

> Lay the phone flat between two friends and let the molecule tumble slowly. The first thumb on the buzzer when benzene goes edge-on, a C60 pentagon faces up or water looks straight wins the point, scored in degrees.

**Framing:** capability->problem

**Builds on:** New. Answers the curated observation prompts (a round-1 product gap), is kin to C090 Shadow Match, and shares Flipper Spin's principal-axis code.

**Problem:** Capability: the curated collection's own observation prompts are about special viewing directions. Water asks 'straight or bent?', benzene 'from above, then from the side', C60 'look for different polygon shapes', and the (6,6) nanotube 'look down the tube'. A phone flat on a table is a natural two-player board, and buzzers are direct taps that iOS can feel. Problem: those prompts are passive text today, and 2D projections quietly mislead; a bent molecule can look straight.

**Solution:**

1) Landscape, phone flat. Two big Haptic Moment buzzers sit at the short edges, their labels rotated 180° to face each player. Simultaneous presses are resolved by event.timeStamp.
2) A round opens with a prompt card, such as 'Buzz when the ring is edge-on'. The camera tumbles slowly along a seeded path of springs between random orientations, passing near the target a few times.
3) On a buzz, the view freezes, the target axis draws for a second, and the score is an angle: 'Blue: 4° off edge-on, point'. A buzz more than 15° off gives the point to the other player.
4) The water twist. When water looks straight, the card says 'It looks straight, but water is bent (about 104.5°). You are seeing it edge-on.'
5) Targets are baked per curated molecule into a small reviewed manifest with provenance, including tolerances and wording for content-steward review: plane normals (the smallest principal axis of the coordinates) for planar molecules; the tube axis (the largest); and C60's five-fold and three-fold axes (pentagon and hexagon centroids, from ring perception on the bond graph).
6) Snap-cards mode, for reduced motion, Low Power Mode and anyone who prefers it. Instead of a tumble, a still pose is dealt every ~1.2 s like a card, about one in five within tolerance; slap the right card.
7) Solo: beat your best angle on a seeded tumble, a candidate rotating format for the C088 Daily.

**Experience:** Table: two friends, two thumbs, a quick round per molecule, and loud groans at '16°, too early'. Desktop: A and L keys for two players on one keyboard. Keyboard only: Space buzzes in solo. Screen reader: the tumble becomes a choice round, 'Which view is edge-on? 1: atoms form a hexagon. 2: atoms form a line. 3: atoms form a zigzag', with shape descriptions computed from the pose.

**Tech:** math@0.1.0 quat.slerp driven by a scalar spring on t, since math has no quaternion spring (pre-1.0); mulberry32 seeds; a 3x3 eigen-solve for principal axes, shared with Flipper Spin; ring perception on the bond graph (small N); DOM buzzers; C003 tokens; manifest JSON under the science-bundle contract.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it (camera-only motion plus DOM).

**WebGL2 fallback:** Identical on the WebGL2 backend. Low Power Mode: Snap-cards is the default, which plays better than a stepped tumble; the camera renders one still per card.

**Where in code:** packages/ui/src/gallery/studentCollection.ts (prompts for water, benzene, c60_buckyball, cnt_6_6); packages/scene/src/bondTopology.ts; packages/ui/src/app/CameraManager.tsx; new packages/ui/src/toys/symmetrySnap.ts plus a manifest in packages/core

**Risks:** Two thumbs on a small phone need buzzers of at least 72 px, well spaced. A tumbling camera can bother some players; keep it slow, cap angular speed, and offer cards mode. A phone lying flat brings glare and poor viewing angles. The manifest needs steward review.

**Honesty:** Targets are geometric facts computed from displayed coordinates and ship with provenance. Only the view moves. The water card explicitly corrects the projection illusion.

**Judges:**

- E 3/keep: Camera-only on Object Facts and cheap, but the scripted camera tumble breaks the comfort rule that the camera never moves without input. *Improve:* Tumble the molecule as a display-only rigid transform (or cards mode by default) under play-10's caps.
- P 4/keep: A buzzer duel on 'benzene goes edge-on' is understood instantly, social and loud, which is perfect couch energy, and it trains seeing shape. *Improve:* Short rounds (20 s or less), buzzers at least 72 px, and a solo 'beat your angle' mode.
- A 3/keep: A slow random tumble passes through many ugly poses and looks aimless. *Improve:* Tumble with detent-to-detent slerps, so it passes through composed views.
- Pr 3/keep: A social tabletop game grounded in real symmetry, but a niche posture: the phone lies flat between two players. *Improve:* Build it after Hide an Atom, reusing Object Facts.
- M 3/keep: Cards mode is the default under reduced motion and LPM, which is good, but the camera tumbles without input and the reaction race excludes some players. *Improve:* Add a WCAG 2.2.2 pause, an untimed solo variant, and a slow tumble under PE-10 caps.

<a id="r2-pocket-native-play-09"></a>
## Sideways Is a Camera: turn the phone and the viewer becomes a specimen viewfinder
`R2-pocket-native-play-09` · toy · effort M · judges mean **3.4** (E3 P4 A4 Pr3 M3; keep 1, rework 1, merge 3) · self-scored fun 4 / visual 4 · perf neutral

> Turning the phone sideways, the way everyone holds it to take a photo, turns the chrome into a viewfinder: Look chips under the left thumb, a big shutter under the right, and the shot goes straight to the share sheet.

**Framing:** capability->problem

**Builds on:** C060 + C061 (specimen shutter) + C105/C106 through D4's capture service + C113's landscape two-thumb posture

**Problem:** Capability: people turn phones sideways to take pictures, so that posture is a clear signal of intent. iPhone Safari offers no programmatic orientation lock and no element fullscreen, so the web has to respond to rotation rather than force it. Problem: landscape today is a squashed portrait layout (the mobile media query covers landscape phones), and saving a nice view means opening Export and a panel built for figures.

**Solution:**

1) Rotate to landscape with a molecule loaded, no sheet open and no finger down (debounced 400 ms), and the chrome melts into a viewfinder. The left edge column holds Look chips: Illustrate, Studio and Paper, each a Haptic Moment that crossfades on the mood bus. The right edge column holds a big round Shutter at the bottom right under the thumb, a Frame toggle (rule-of-thirds plus a horizon level) and Exit. The molecule reframes to the wider aspect with a C003 glide into the nearest detent.
2) Rotation seam. During the OS rotation, the last frame is held as a CSS snapshot. The canvas resizes once at the end and one frame renders at the new size, which avoids repeated reallocation. Watch the stale-DPR bug (#3958) on v10.
3) Shutter. A tap clicks on iOS. On v10 it is C060/C061's specimen shutter: a bounded idle accumulation, then sleep, through D4's capture service at a fixed size. The result is a card with generated alt text ('Caffeine, C8H10N4O2, Illustrate look') that goes to navigator.share({files}) or is saved. On v9 it is canvas.toBlob of the preserveDrawingBuffer canvas at the current view, then share.
4) Long-press the shutter for a three-shot contact sheet at the three nearest hero detents.
5) With a trajectory loaded, sideways shows a cinema strip instead: a full-width scrubber and frame steppers (Haptic Moments), with the shutter still present.
6) Orientation lock on? A Camera chip in the Rail opens the same viewfinder in portrait at 4:5.
Reduced motion: reframing and look changes cut or crossfade, with no glide.

**Experience:** Phone: turn it, frame with the left thumb, click with the right, share to Messages. Desktop: the Camera chip opens the framed mode; C opens it, Enter fires the shutter, and 1-3 pick looks. Screen reader: 'Shutter, button'; after a shot, 'Photo taken: caffeine, Illustrate look. Share or save.'

**Tech:** matchMedia('(orientation: landscape)'), screen.orientation change events and visualViewport; setViewOffset plus a math/time spring for the reframe (pre-1.0). On v10: useRenderTarget and fixed-size output (R3F v10 canary), readRenderTargetPixelsAsync and idle accumulation. Web Share Level 2 (navigator.canShare and share({files})), with a ClipboardItem fallback. On v9: HTMLCanvasElement.toBlob. iPhone orientation-lock limits: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide

**Backend:** mixed

**Rides (v10 requirements):** R9 and R6 for the accumulating shutter; R7

**v9 slice:** The landscape viewfinder, Look chips, toBlob shutter and share, all on v9 as illustrative output, never as an MCP artifact.

**WebGL2 fallback:** The viewfinder is DOM plus camera. Render-target readback is expected to work on the WebGL2 backend (verify), with fewer accumulation frames. Low Power Mode: the shutter accumulates over a fixed wall-clock budget, so it gathers fewer frames rather than taking longer; the viewfinder is demand-driven.

**Where in code:** packages/ui/src/hooks/useMediaQuery.ts (MOBILE_MEDIA_QUERY includes landscape phones); packages/ui/src/app/CameraManager.tsx (orientation refit logic); packages/ui/src/ExportManager.tsx and FigureExportPanel.tsx; packages/ui/src/viewer/ViewerCanvas.tsx

**Risks:** Lying on a couch flips the orientation by accident; debounce, and never switch mid-touch. One canvas resize per rotation is unavoidable. Landscape brings its own safe areas and the Safari toolbar. navigator.share with files varies by browser; check canShare and fall back to download.

**Honesty:** Shots are illustrative images labelled with the look's name. Alt text uses only name, formula and look. They are never MCP artifacts, and the deterministic export profile is unchanged.

**Judges:**

- E 3/merge: Merge into R2-capture-share-loops-09. Auto-switching the chrome on rotation risks accidental couch flips and forces a canvas resize. The landscape viewfinder is a skin on the Specimen Camera. *Improve:* Offer the viewfinder rather than auto-entering it, and never switch mid-touch.
- P 4/keep: Rotating to landscape is what people already do to take a photo, so the viewfinder is discovered by posture alone. The risk is accidental rotation on a couch. *Improve:* Debounce, offer one-tap exit, and add Star-Trail as a shutter mode.
- A 4/merge: Host: R2-capture-share-loops-09. The viewfinder posture (rule-of-thirds, a horizon level, Look chips under the left thumb) improves composition. *Improve:* Make it cap-09's landscape mode.
- Pr 3/merge: Merge into R2-capture-share-loops-09. Landscape as a viewfinder is a nice posture, but it is another shutter. *Improve:* Make it the landscape layout of the Specimen Camera.
- M 3/rework: Entering a mode by rotation fires by accident on couches, is unreachable with rotation lock on, and is undiscoverable without sight. *Improve:* Add an explicit Camera button, with rotation only offering the mode. Use a stills rung in LPM and never switch mid-touch.

<a id="r2-pocket-native-play-10"></a>
## Stop-Motion Pocket: detect the locked 30 fps and play in held poses, not stutter
`R2-pocket-native-play-10` · system · effort M · judges mean **3.8** (E4 P3 A4 Pr3 M5; champion 1, keep 4) · self-scored fun 3 / visual 3 · perf improves

> A rAF probe that renders nothing tells a Low Power Mode cap apart from a slow GPU. Capped phones keep direct manipulation continuous but switch toys to art-directed held-pose flip-books and a turn-based deck, instead of degraded continuous motion.

**Framing:** problem->solution

**Builds on:** C004 (fixes its Low Power Mode misread) + C055 (the on-twos reference) + C002 + C027 + the C028/C030 still variants

**Problem:** This is the old-iPhone double penalty. iOS 17 and 18 land on WebGPURenderer's WebGL2 backend; Low Power Mode caps rAF at 30 (WebKit bug 168837); and Safari throttles rAF in cross-origin iframes until the user interacts. Continuous toys then stutter. Worse, a frame-time quality ladder (C004) mistakes the cap for a weak GPU and strands the phone on a low tier, which was the mobile judge's objection. Web pages cannot read Low Power Mode directly.

**Solution:**

1) Cadence Sentinel. After the compileAsync warm-up, at onIdle, and on every visibilitychange back to visible, run a bare requestAnimationFrame probe of about 20 callbacks that renders nothing and invalidates nothing. The cap signature is a median interval of 33.3 ms (±1) with p90 minus p10 under 2 ms. Because nothing is rendered, a slow GPU still shows about 16.7 ms; only a cap shows 33.3 (Low Power Mode, an Android battery saver, or an embed before interaction). Embeds re-probe after the first interaction. Generalise the rule to 'locked below display rate'. In the Expo shell, expo-battery's Low Power Mode flag replaces the guess (Lupi Pocket).
2) When capped, switch to the pocket-stills profile:
a) Direct manipulation (orbit, flick, pinch, loupe) stays continuous, because it is the one thing that must feel alive.
b) Ambient jobs stop: C020's breathing, snow drift, attract mode.
c) Toys switch to held-pose flip-books. Each toy declares key times on C003's tokens, and a scheduler job at fps 12 with drop: false invalidates on that grid. A poke ripple (C028) becomes three held poses and a settle, the condensation (C030) four, the burst three, and a Remix morph two plus a crossfade. Because C027's deformers are closed-form f(base, t), every key pose is exact. The look is C055's claymation 'on twos', art-directed rather than dropped frames.
d) The Pocket Context Deck leads with turn-based toys: Hide an Atom, Symmetry Snap cards, Plumb Line's rest pose, the Daily, and C035's knife as a still.
e) C004's ladder is told the device is capped, not slow, and drops no rung on cadence alone.
3) Honest UI: a Crown note, 'Battery saver: stop-motion', with a 'Smooth anyway' switch that is remembered for the session.
4) Reduced motion shares the same machinery: one still per action there, three or four held poses per action here.

**Experience:** An old iPhone in Low Power Mode on a train: the molecule still glides under the thumb, a poke answers in three crisp beats like stop-motion, and the games are turn-based and never stutter. Desktop: it never triggers unless the browser caps rAF. Keyboard and screen reader: unchanged, and the note is announced once.

**Tech:** A requestAnimationFrame probe. @pmndrs/scheduler 0.2.0: per-job fps with drop: false, and onIdle (pre-1.0; no fixed step). R3F v10 useFrame({ phase, fps }) (canary). state.webGPUSupported and renderer.backend.isWebGPUBackend. C027's closed-form deformers and C003's tokens. expo-battery through the shell. Sources: https://bugs.webkit.org/show_bug.cgi?id=168837 and https://birchtree.me/blog/how-to-enable-120hz-mode-in-safari-mac-iphone-and-ipad/ (Safari keeps rAF near 60 Hz on ProMotion by default).

**Backend:** mixed

**Rides (v10 requirements):** R7 (scheduler), R3 (closed-form deformer poses)

**v9 slice:** The sentinel, the note and deck ordering on v9 (scheduler 0.2.0 runs without v10). A v9 flip-book condensation steps the existing uProgress through 0, 0.35, 0.7 and 1 with holds, with zero new GLSL.

**WebGL2 fallback:** This is the design for WebGL2 plus Low Power Mode. On the WebGL2 backend without a cap, toys run continuously at their own stated lower counts. Under Low Power Mode, flip-books render 3-4 frames per action, then sleep.

**Where in code:** packages/ui/src/viewer/ViewerCanvas.tsx:67 (frameloop 'always' today); packages/ui/src/deviceCapabilities.ts (UA-based tiers); packages/scene/src/AtomsOptimized.tsx (uProgress interpolation); packages/ui/src/lib/spring.ts; new packages/ui/src/perf/cadenceSentinel.ts

**Risks:** False positives from 30 Hz displays or other throttles; the override switch and re-probing handle these. Probe noise during parsing, hence running at onIdle. Some players prefer smooth motion even on battery. CSS-driven DOM motion may run at a different rate from rAF, so DOM chips keep CSS animations.

**Honesty:** The note says why motion changed. Held poses are the same illustrative motion, labelled as before. No frame-rate claims, and export is unaffected.

**Judges:**

- E 4/keep: A rAF probe that renders nothing is a cheap, clean way to tell a Low Power Mode cap from a slow GPU, which fixes C004's misread. Held-pose flip-books are calmer on the old-iPhone double penalty. A clean probe needs the demand frameloop (scheduler 0.2.0 already works on v9). *Improve:* Probe only at onIdle and on visibility return. Expose an override.
- P 3/keep: Turning Low Power Mode's 30 Hz into an art-directed 'on twos' style instead of stutter is smart feel design for old phones. *Improve:* Keep direct manipulation continuous, and verify the cadence probe on real Low Power Mode iPhones.
- A 4/keep: Holding poses on twos instead of stuttering at 30 Hz is a real animation principle, and art-directed flip-books look intentional rather than degraded. *Improve:* Author key poses per toy (from play-11's stills), with spacing taken from the token curve.
- Pr 3/keep: The cadence sentinel cheaply fixes C004's misreading of Low Power Mode. The held-pose flip-books need art time. *Improve:* Ship the sentinel first, and the flip-books toy by toy.
- M 5/champion: Verified: iOS Low Power Mode throttles rAF and CSS animations to 30 fps (and cross-origin iframes until a tap). A bare rAF probe at idle tells a cap from a slow GPU, and capped phones get art-directed held poses and turn-based toys instead of stutter. *Improve:* Re-probe on visibilitychange and after embed interaction, offer a 'smooth anyway' override, and share the signal with C004 so a capped phone is never downgraded as 'slow'.

<a id="r2-pocket-native-play-11"></a>
## Pocket Memory Ledger: stay under the tab-kill line, and come back gracefully if not
`R2-pocket-native-play-11` · foundation · effort M · judges mean **3.0** (E3 P2 A2 Pr3 M5; keep 5) · self-scored fun 1 / visual 1 · perf improves

> Every big allocation reports its bytes to one ledger with a device budget and a designed degrade order. A backgrounded tab slims itself, and if iOS kills it anyway, the reload returns to the same view as a lighter 'safe pocket' with an honest note.

**Framing:** problem->solution

**Builds on:** C004 + C014 (budgets and the device lab) + D3's per-atom byte budget, brought to the phone

**Problem:** deviceCapabilities.ts records that the 1M-atom scale test 'was capable of crashing mobile devices outright', and estimates ~28 MB of CPU instance buffers per million atoms plus a GPU mirror. Yet the mobile profile's maxAtoms is the 50M global ceiling. By that comment's own arithmetic, a 5M-atom scene carries roughly 280 MB of atom buffers before render targets, streaming frames (64 MB resident by default) and v10's offset buffers. iOS kills the WebContent process at a threshold that varies with the device and system load (Apple publishes no fixed number), and a killed tab reloads to a blank state. The Expo shell already catches content-process termination, but it simply reloads.

**Solution:**

1) Ledger. Each allocation site registers its bytes by class:
- frame typed arrays (estimateFrameResidentBytes already exists);
- GPU instance buffers (positions 12 B per atom, unorm8x4 4 B, v10 half4 offsets 8 B);
- bond pairs;
- render targets (width x height x bytes per MRT attachment, HalfFloat versus UnsignedByte);
- PMREMs;
- 2D canvases for the splash, loupe and capture (iOS has historically enforced a separate canvas-memory cap);
- gist particles.
The ledger is a lower bound and says so. C014's ?perf HUD shows it.
2) Budget. Start with a conservative budget per device class, calibrated on C014's named-device lab rather than assumed, and check it before any large allocation.
3) Degrade order before refusing:
- cut streaming residency from 64 MB to 16 MB and lookahead to 2;
- use UnsignedByte output on mobile;
- release transient targets (capture, accumulation, loupe crop) right after use;
- drop DPR to 1.0;
- lower the quality tier;
- then, gated and L-sized, drop CPU frame copies after GPU upload above N atoms, with an async accessor for features that need coordinates;
- finally, offer 'Open a 250k-atom region' instead of loading.
4) Background hygiene. On visibilitychange to hidden, free transient targets, detach sensors (Motion Switch), and pause streaming and prefetch. A lighter backgrounded tab is less likely to be evicted.
5) Crash-aware reload. Before a large upload, write a sessionStorage breadcrumb {scene, atoms, tier, time}, cleared on pagehide. On load, a recent matching breadcrumb plus a 'reload' navigation type means a probable kill. Open the same saved view (the state that lupi.encode_view_url already serialises) as a safe pocket, with 'Your phone ran out of room for 4.2M atoms, so this is a lighter view. Try full quality?' The Expo shell adds ?pocket=safe to its termination reload.

**Experience:** Phone: huge scenes open lighter instead of crashing, and after a crash you land back on the same molecule and camera with the reason in words. Desktop: invisible except in ?perf. Keyboard and screen reader: the safe-pocket note is announced in a live region, with a real button.

**Tech:** A ledger module; performance.getEntriesByType('navigation')[0].type; sessionStorage plus pagehide; renderer.info.memory; v10 outputBufferType UnsignedByteType; GPUDevice.lost (D3's recovery); the Cache API for re-reading source files; apps/mobile viewer-recovery.ts. Sources: https://developer.apple.com/forums/thread/771787, https://bugs.webkit.org/show_bug.cgi?id=195325

**Backend:** mixed

**Rides (v10 requirements):** R3 and R6 (buffer and target sizes), R12 (one device), R7

**v9 slice:** All on v9: the ledger for CPU, frame and 2D-canvas bytes; the streaming clamp; background hygiene; the breadcrumb and safe pocket; and the Expo flag.

**WebGL2 fallback:** The same ledger runs on the WebGL2 backend. Before r187 the fallback leaks GL objects on material or scene churn (#34597), which the ledger reports as churn, so ship on r187. Low Power Mode doesn't change the memory policy.

**Where in code:** packages/ui/src/deviceCapabilities.ts (the 1M crash note; mobile maxAtoms = the 50M ceiling); packages/ui/src/streamingFrameCoordinator.ts (DEFAULT_STREAMING_RESIDENT_BYTES, clampLookaheadForActiveFile); packages/ui/src/gallery/loadGalleryExample.ts; apps/mobile/src/features/viewer/viewer-recovery.ts and viewer-surface.native.tsx

**Risks:** Lower-bound accounting misses browser and driver overhead. A manual reload could trip safe pocket, so require a large scene and a recent breadcrumb. The gated CPU-copy rung touches many readers of frame.positions. Budgets tuned without device data would be guesses.

**Honesty:** The note says 'lighter view' plainly and names what was reduced. Data is never silently substituted.

**Judges:**

- E 3/keep: A lower-bound byte ledger with a designed degrade order, plus a 'safe pocket' reload after an iOS tab kill, is practical. It overlaps port-05 on GPU bytes. *Improve:* Take per-atom figures from port-05's allocation table so there is one ledger.
- P 2/keep: A tab kill on iPhone is the worst possible session ending, but the ledger is plumbing. *Improve:* Lead with the breadcrumb and the 'safe pocket' return, which is the part a player notices.
- A 2/keep: Outside my lens. *Improve:* The 'safe pocket' reload should use sig-08's plate.
- Pr 3/keep: It prevents iOS tab kills from losing a visitor's work, and the 'safe pocket' reload is honest about what happened. *Improve:* Ship the breadcrumb and safe pocket on v9.
- M 5/keep: iOS tab kills are the most common real failure on large scenes. A ledger with a designed degrade order, background slimming and a safe-pocket reload with an honest note is graceful degrade. *Improve:* Treat the lower bound as a floor, add the r187 GL2 leak to it, and feed per-class budgets from PT-09.

<a id="r2-pocket-native-play-12"></a>
## Pocket Data Plan: nothing big happens on cellular without a visible size
`R2-pocket-native-play-12` · foundation · effort S · judges mean **3.0** (E3 P2 A2 Pr3 M5; keep 5) · self-scored fun 1 / visual 1 · perf improves

> Byte classes with explicit rules for cellular and Data Saver: a Data saver switch for iPhones, which expose no signal, size chips on trajectories and heavy toy chunks, and a byte meter for the visit.

**Framing:** problem->solution

**Builds on:** C016 (intent prefetch made data-aware, the mobile judge's condition) + C080/C067 (their Save-Data notes) + D3's lazy toy registry

**Problem:** A first viewer visit costs about 1 MB gzipped for the viewer chunk, plus the ~176 KB WebGPU vendor chunk that v10 makes mandatory. Gallery trajectories can autoplay and stream: files above 5 MB stream, with a 12-14 frame lookahead. Lazy toys will add heavy chunks (openchemlib 9.25.0 is 6.1 MB unpacked on npm, and the size of the part Lupi would ship is unmeasured). /scan uploads photos. Chromium exposes navigator.connection.saveData and sends a Save-Data header, but Safari on iPhone exposes neither, so most iPhone visitors look like they're on unlimited Wi-Fi.

**Solution:**

1) Signals.
- Chromium: navigator.connection.saveData and effectiveType, and the Save-Data header.
- iPhone web: no signal at all. So there is a Data saver switch in Settings, plus a one-time prompt at the first fetch over 5 MB.
- Expo shell: expo-network's cellular type and NetInfo's isConnectionExpensive, injected into the page (Lupi Pocket).
2) Rules while Data saver is on.
a) Chunks. C016's prefetch fires only on commit (a tap), not on hover or a 100 ms hold. No prefetch of [GPU]-only extras. Hashed chunks are served immutable, so a return visit costs almost nothing.
b) Molecule data. Trajectories don't autoplay-stream. The first frame loads, and a Play chip shows the size ('Play, 18 MB'), taken from the Content-Range total that loadGalleryExample already reads with its 4 KB Range probe. Lookahead clamps to 2 and resident frames to 8.
c) Toys. Each entry in D3's lazy toy registry declares its gzipped bytes, and any toy chunk above ~250 KB shows a size chip before downloading. Sound cues are synthesized ZzFX-style rather than downloaded.
d) Uploads. /scan downsizes photos on the device and says 'uses mobile data'.
3) A byte meter in Settings, 'This visit: 3.4 MB', from Resource Timing's transferSize where supported, plus Lupi's own fetch counts.
4) Data saver also stops the Pocket Context Deck from prefetching chunks for toys it might suggest.

**Experience:** Phone on cellular: big things wait behind a chip that says how big. On Wi-Fi nothing changes. Desktop: off by default. Keyboard and screen reader: size chips are labelled buttons ('Play trajectory, 18 megabytes').

**Tech:** Network Information API (Chromium only); the Save-Data header; Resource Timing transferSize; HTTP Range and Content-Range; dynamic import() with Vite-manifest modulepreload; Workers static-asset cache headers; expo-network and @react-native-community/netinfo in the shell. Sources: https://caniuse.com/netinfo, https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Save-Data, https://docs.expo.dev/versions/latest/sdk/network/

**Backend:** DOM/CPU

**Rides (v10 requirements):** R1 (bundle hygiene), R12 (the WebGPU vendor chunk becomes mandatory)

**v9 slice:** All of it on v9.

**WebGL2 fallback:** Not renderer-dependent. Low Power Mode is not a data signal, but pocket-stills also skips decorative prefetch.

**Where in code:** packages/ui/src/gallery/loadGalleryExample.ts (Range probe, STREAMING_BYTES_THRESHOLD, autoPlay, initialLookahead 12 / playbackLookahead 14); packages/ui/src/streamingFrameCoordinator.ts; apps/mcp-worker (static-asset headers); packages/ui/src/scan (photo upload)

**Risks:** iPhone users won't find a buried switch, hence the one-time prompt at the first big fetch. Gzip versus transfer sizes make estimates approximate. Varying the HTML on Save-Data would fragment caches, so decide on the client instead.

**Honesty:** Sizes are labelled as estimates from headers. Data is never degraded without saying so.

**Judges:**

- E 3/keep: Small and v9, it makes C016's prefetch data-aware. iPhones expose no signal, so the switch plus a first-big-fetch prompt is the only honest approach. *Improve:* Put size chips on trajectories and stream heavy runs through HTTP Range.
- P 2/keep: Size chips on cellular are respectful but not fun. *Improve:* Keep it to the prefetch rule and a single prompt.
- A 2/keep: Outside my lens. *Improve:* Style the size chips as tray chips.
- Pr 3/keep: It respects Save-Data, and the size chips are honest, but iPhones give no data signal to act on. *Improve:* Show a one-time prompt at the first fetch over 5 MB.
- M 5/keep: iPhones expose no Save-Data signal, and the viewer, WebGPU chunk and trajectories add up to tens of MB. A Data saver switch, a one-time prompt at the first 5 MB fetch and size chips are the honest fix, S effort on v9. *Improve:* Default Data saver on when the Expo shell reports cellular, and show sizes in words for screen readers ('12 megabytes').

<a id="r2-pocket-native-play-13"></a>
## Lupi Pocket: the Expo shell does what iPhone Safari can't
`R2-pocket-native-play-13` · share-loop · effort M · judges mean **2.8** (E3 P3 A2 Pr3 M3; keep 4, park 1) · self-scored fun 3 / visual 2 · perf improves

> The existing Expo app becomes the premium pocket channel. A whitelisted cue bridge gives native haptics to drags and detents, true Low Power and cellular signals reach the viewer, clips and cards leave through the native share sheet, and store presence finally opens shared links in the app.

**Framing:** capability->problem

**Builds on:** C041 + C110 + C103/C106 (through D4) + C088; fills the round-1 gap 'distribution through the Expo shell'

**Problem:** Capability: apps/mobile is an Expo SDK 57 app that already wraps the web viewer in a WebView bridge (status, response and error messages). It calls expo-haptics on native controls, shares URLs through the iOS share sheet, runs a native Viro ARKit Room, and handles content-process termination. Its TestFlight gate fails only on the missing ascAppId. Problem: iPhone Safari can't tick during drags, can't detect Low Power Mode or cellular, shares files awkwardly, and shared links always open in Safari.

**Solution:**

1) Cue bridge. Add a whitelisted cue message to parseViewerSurfaceMessage: {type: 'cue', cue: 'detent' | 'snap' | 'limit' | 'flip' | 'found' | 'catch'}. When the page detects the shell (window.__lupiNativeBridgeInstalled), C041's cue bus posts cues there and suppresses its own web haptics. Native code maps them to Haptics.selectionAsync, impactAsync (Light, Medium, Rigid) or notificationAsync(Success), rate-limited to about 20 per second and behind a Settings toggle. Only here can an iPhone feel detents during a coast, loupe snaps while sliding, rubber-band limits and Flipper Spin's flip.
2) Truth in. expo-battery's isLowPowerModeEnabledAsync plus addLowPowerModeListener, and expo-network or NetInfo's cellular and isConnectionExpensive, are injected as window.__lupiPocket via injectJavaScript whenever they change. Stop-Motion Pocket and the Data Plan then stop guessing.
3) Files out. A size-capped share-file message (mime, base64, title, alt) is written to the cache with expo-file-system and handed to the share sheet: RN Share with a file URL on iOS, expo-sharing on Android. This carries D4's clips and cards.
4) Room. C110's 'On my desk' opens the native Room inside the app instead of Quick Look.
5) Store presence.
- Set ascAppId and ship TestFlight.
- Add Associated Domains plus an apple-app-site-association file served by the Worker, so lupi.live/view/:slug opens the app when it is installed (today only the lupi:// scheme exists).
- Add a Smart App Banner (meta apple-itunes-app with app-argument) to the Worker's /view/:slug share pages.
- Make App Store screenshots in the Illustrate voice from the Daily.
- Later, and unverified in this repo: a Daily home-screen widget through a WidgetKit target (needs a development build, not Expo Go).
6) The WebView stays a parity bridge; there is no native renderer fork.

> **Amendment 2026-10-04.** Superseded for iPhone and iPad. The owner chose a native SwiftUI + RealityKit app at `apps/apple` that takes the `live.lupi.app` bundle id and replaces this Expo shell, which is frozen as a reference ([AR decisions](../../../ar/decisions.md), D1). It has a native renderer of its own and shares data, contracts and bond rules with the web, not the web React tree (as `docs/mobile-expo.md` asks). The plan of record is [docs/ar/plan.md](../../../ar/plan.md).

**Experience:** In the app, detents click during a flick, trajectories ask before streaming on cellular, stop-motion switches on exactly when Low Power Mode does, clips go to Messages in one tap, and shared links open in the app. On the web, a quiet banner appears on shared-view pages only. Keyboard and VoiceOver: native controls already carry accessibility labels, and cues never carry information on their own.

**Tech:** expo-haptics (installed); expo-battery and expo-network (to add); @react-native-community/netinfo (optional); expo-file-system (installed); react-native Share; expo-sharing (Android); react-native-webview injectJavaScript; ios.associatedDomains in the app config; apple-app-site-association; the Smart App Banner meta tag. Sources: https://github.com/expo/expo/blob/main/packages/expo-battery/src/Battery.ts, https://docs.expo.dev/versions/latest/sdk/netinfo/

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it. The shell hosts today's v9 viewer, so nothing waits for the port.

**WebGL2 fallback:** Inside WKWebView on iOS 17 and 18 the viewer takes the WebGL2 path, and the shell reports Low Power Mode exactly. Whether WKWebView on iOS 26 exposes WebGPU as Safari does must be verified.

**Where in code:** apps/mobile/src/features/viewer/viewer-bridge.ts (parseViewerSurfaceMessage whitelist, bootstrap script), viewer-screen.tsx (Share.share with a URL), viewer-control-bar.tsx (Haptics.selectionAsync), viewer-recovery.ts; apps/mobile/app.config.ts (scheme lupi, no associatedDomains); apps/mobile/README.md (TestFlight gate missing ascAppId); apps/mcp-worker (GET /view/:slug share HTML)

**Risks:** Haptics fire twice if the web doesn't suppress its own. App Review's minimum-functionality rule for web-wrapper apps (the native Gallery, Library and Room help). Message validation must stay strict. Base64 file transfer has size limits. Widget targets add native build complexity.

**Honesty:** Haptics and banners carry no science. Room AR keeps the honest 1 Å = 1 cm scale. Shared files are illustrative outputs.

**Judges:**

- E 3/keep: The Expo shell is the only route to drag and detent haptics on iPhone and to exact Low Power Mode and cellular signals. App Review's rule against minimal web wrappers is a real risk. *Improve:* Keep the cue bridge whitelisted and rate-limited, and suppress web haptics when the shell is detected.
- P 3/keep: Native haptics on drags and detents would be the juiciest iPhone experience of all, but only for people who install an app. *Improve:* Treat it as a premium channel, and never design the web toys around it.
- A 2/keep: Outside my lens. *Improve:* Native share should carry cap-02's templates unchanged.
- Pr 3/park: A real distribution channel, but App Review's minimum-functionality rule and a second release surface are costs to take on only once the web loops show retention. *Improve:* Revisit when retention data exists.
- M 3/keep: The app shell is the only path to drag-tied haptics and an exact LPM signal on iPhone, but App Review and double-haptics are risks. *Improve:* No feature may be app-exclusive in a way that leaves web users out, and give native haptics a Settings off toggle.

<a id="r2-pocket-native-play-14"></a>
## Pocket Context Deck: the right three toys for how you're holding the phone
`R2-pocket-native-play-14` · flagship · effort M · judges mean **2.2** (E2 P3 A2 Pr2 M2; keep 1, rework 1, merge 1, park 2) · self-scored fun 4 / visual 3 · perf improves

> A private, on-device read of posture, grip, battery cadence, data and sensors picks which three toy chips sit in the thumb arc: one-thumb commute, two-thumb couch, phone on the table, or sideways. The full Play menu is always one tap away.

**Framing:** problem->solution

**Builds on:** C021 + C028 + C091 + C115 (salvage) + C019 (discoverability without a hand); the pocket counterpart to D2's grammar and D1's first minute

**Problem:** Rounds 1 and 2 together will produce dozens of toys, and on a phone they end up either as a wall of panels or invisible. The right toy depends on the moment. Standing on a train with one thumb, on cellular and maybe in Low Power Mode, is not the couch with two thumbs and a friend, and neither is a phone flat on a café table.

**Solution:**

1) Signals, all on-device and never sent:
- posture: portrait or landscape; 'flat on a table' only if Motion is on and gravity lies along the screen normal;
- grip: simultaneous touches, flipper use, and Thumb Arc's handedness;
- cadence (Stop-Motion Pocket);
- data (Pocket Data Plan);
- sensors (Motion Switch);
- time in session.
2) The Deck. The Rail's arc shows three chips, and the full Play menu always holds everything. Chips change only at rest, at most once a minute, and never while a finger is down.
3) Storyboards.
- Commute (one hand, portrait). The Deck is Detents, the Spin flipper and a Loupe hint. Data saver is on if cellular is known. Motion isn't suggested, since a shake on a train is an accident. Pocket-stills applies if the cadence is capped. At about two minutes, 'Hide an atom for later' seeds a C091 seeded link built from preset clues.
- Couch (two thumbs). The Deck is Flippers, the Motion switch and Hang. After a few minutes: 'Playing with someone? Hide an Atom.'
- Table (landscape, no touches for a while, or flat). The Deck is the Symmetry Snap duel and Hide an Atom.
- Sideways with a molecule loaded: the Camera viewfinder.
- Capped cadence: turn-based toys first.
4) PII-free, aggregated events (deck_chip_used {chip, context}, handoff_started, duel_round, shutter, stills_profile_on) let C014 learn which context guesses were right.
5) Keyboard, desktop and screen-reader users get a stable Deck of keyboard-first toys, with no inference-driven shuffles.

**Experience:** Phone: the chips under your thumb fit the moment, with no settings. Desktop: a stable deck of keyboard-friendly toys. Keyboard and screen reader: the Deck is a nav list whose order doesn't change mid-session, and its reason is readable ('two-thumb toys'). Reduced motion: chip changes cut instead of animating.

**Tech:** DOM heuristics over pointer events and matchMedia; the Motion Switch sensor bus; the Stop-Motion Pocket sentinel; localStorage (try/catch); @pmndrs/scheduler onIdle (pre-1.0) so changes happen at rest; D3's lazy toy registry, so toys that aren't chosen are never downloaded; the C014 event pipe.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (each toy rides its own)

**v9 slice:** A v9 deck of v9-shippable toys: Detents, Flipper Spin, Plumb Line, Hide an Atom, Symmetry Snap and the Camera.

**WebGL2 fallback:** When state.webGPUSupported is false, the Deck prefers toys whose cost doesn't depend on compute. On Low Power Mode it leads with turn-based toys (Stop-Motion Pocket).

**Where in code:** packages/ui/src/ViewerApp.tsx (Rail); packages/ui/src/app/ViewerGestureHint.tsx (current one-shot hint and its sessionStorage key); new packages/ui/src/pocket/contextDeck.ts

**Risks:** Wrong inferences surface the wrong chips; this is cheap, because the full menu stays. Shuffling chips can feel random, hence rest-only changes, a capped rate and a stable deck for keyboard users. Inference can feel creepy if explained badly, so say 'two-thumb toys', never 'we detected'.

**Honesty:** Signals never leave the device. The Deck only reorders shortcuts and never hides a feature.

**Judges:**

- E 2/park: Inferring posture and grip to reshuffle chips adds hidden state and unpredictable UI, for a payoff that depends on toys that don't exist yet. *Improve:* Revisit once more than six toys exist and telemetry shows chip discovery failing.
- P 3/merge: Picking the right three toys for your posture is clever, but chips that shift break muscle memory and discoverability. Host: R2-play-for-everyone-03. *Improve:* Use its signals only to order the Play tray's first row, never to hide or move chips during a session.
- A 2/keep: Chips that shuffle by inferred posture are UI motion that reads as random. *Improve:* Change chips only at rest, animate them on the snap token, and keep the deck stable within a session.
- Pr 2/park: Chips that shuffle based on inferred posture hurt learnability and add hidden state, and the full menu already exists. *Improve:* Use a fixed deck until telemetry shows a need.
- M 2/rework: Chips that change with inferred posture break predictability (WCAG 3.2.3 Consistent Navigation) for screen-reader, switch and cognitive users. A stable deck only for keyboard users is a partial fix. *Improve:* Use a fixed deck with one clearly labelled 'Suggested' slot, keep inference opt-in, and never move a chip the user has used.
