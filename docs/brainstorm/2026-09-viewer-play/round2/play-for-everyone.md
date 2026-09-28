# Round 2 · One Gesture Grammar, Findable Toys, Play for Everyone

[← all round-2 ideas](README.md)

## Direction notes

THE SYSTEM IN ONE BREATH. One arbiter turns gestures into intents, and every modality reaches every intent: touch, pen, mouse, trackpad, keys, the atom cursor, buttons, switch and the palette. The Play chip is the only thing that changes what one finger does.
- Long-press is for precision.
- Double-tap belongs to the camera.
- Two fingers always move the camera.
- The chip is also the honesty label and the Reset.
- Sensors, flashes, camera comfort and reduced motion are platform contracts a toy must sign, not promises each toy makes separately.

RESOLUTIONS OF THE CONTESTED ROUND-1 IDEAS (idea numbers in brackets):
- C009 wheel: becomes a linear Play tray, opened from the chip, a right-click, a long-press on empty space, the keys or the palette [1, 3].
- C023: double-tap is the camera. On an atom it glides; on empty space it zooms one step; hold-slide zooms; a two-finger tap zooms out. The rubber band stays under the comfort caps, with no squash [1, 10].
- C024: a long-press on an atom opens the loupe, and ambiguous taps open it automatically. The desktop lens becomes a rim, not a radius swell [1, 14].
- C030: the burst leaves double-tap. It moves to the tray button, shake (via the Sensor Door) and the palette. The entrance moves atoms, never the camera [1, 3, 8, 10].
- C031: Tug is a verb that grabs only from an atom; two fingers on two atoms is taffy. Shift+arrows on the atom cursor, and a d-pad for switch users [3, 5, 7].
- C033: heat is a slider plus notches, and charge-and-release becomes heat, then a Release button. It never owns long-press, and the ember sits under the flash budget [3, 7, 9].
- C035: Knife is a verb, not a two-finger swipe, which would break 'two fingers = camera'. It gets X/Y/Z planes and lattice-plane nudges, and sparks are a declared flash class [3, 4, 7, 9].
- C040: Lasso is a verb, with shape stamps around the focused atom. 'Cut out' is a separate step labelled 'derived, unrelaxed' [3, 7].
- C064: Wipe is a verb, plus the only stated exception to 'one finger orbits': a full-frame frost reveal latches Wipe automatically while at least 40% of the frame is fogged. Clear and wipe-a-stripe are the keyboard and switch paths [3, 7].
- Future drawing verbs (C113's doodle flight, C068's doodle) join the chip's verb group and never become one-finger defaults.

TENSIONS RESOLVED.
- (a) The playtester's double-tap burst versus the platform's double-tap zoom: the platform wins. The burst gets a DOM button, which is also the only place iOS web haptics can fire, plus shake and a key.
- (b) Tap to inspect versus tap to pluck: both, at once. Optimistic prefixes mean taps never wait 300 ms. A tap on a moving molecule catches it instead, and a crowded fingertip opens the loupe rather than guessing.
- (c) Modes versus no modes: modes exist only through the chip, with these safeguards:
  - a visible edge while a verb is on;
  - auto-revert after 30 s;
  - verbs that fall back to orbit when started off-target (Tug);
  - a quasimode hold for experts;
  - a pen that does the verb while a finger orbits.
- (d) Radial wheel versus accessibility: a linear menu.
- (e) Arrow keys for frames versus camera: scoped. Arrows turn the molecule in the Scene scope, and frame-stepping moves to , and . (the scrubber keeps its own arrows). This changes behaviour for trajectory users and is flagged as such.
- (f) Trackpad two-finger swipe, orbit versus zoom: orbit is the default, with a setting, and it is explicitly gated on the playtest. I found no universal convention, so I don't claim a precedent.

PRODUCT RULES KEPT.
- Nothing touches /.
- Every displaced pose is labelled by the chip in words and zeroed in export.
- Sensors start only from an explicit tap and show a pill while on.
- Reduced motion gives one designed still per action, enforced by CI.
- Touch marks, toasts and the flash guard sit outside deterministic export.
- No FPS claims. Every threshold is a starting token for the playtest and C014, not a finding: slop 8 px, long-press 450 ms, gutters 20 px, vection budget 360 degrees plus 3 e-folds per minute, flash budget 2 per second, tilt cap 3 degrees.

LEFT TO OTHER DIRECTIONS (deliberately).
- D6: loupe rendering and one-thumb reach zones. I only assign gesture ownership.
- D7: easter eggs and mastery. My meter counts only grammar verbs.
- D3: deformer and toy-registry internals. My toy contract is what registration requires.
- D4: capture and replay. Touch marks are an optional overlay.
- D5: the real-twin curriculum. The manifest only reserves a realTwin slot.
- D1: the first-minute storyboard. Touch marks provide its demo mark.
- No new arcade toys. The one new toy, Bond Walk Radio, fills the grammar's non-visual hole with something only a molecule graph can do: ring-closure chords.

GROUNDED IN THE REPO.
- OrbitControls sets touch-action none.
- html and body have no overscroll-behavior.
- ArrowLeft/Right are global frame-stepping keys, and the single-letter globals v, x, b, t and 1-7 fail WCAG 2.1.4 as written.
- The viewer canvas has no accessible name.
- enablePhoneSnow is the only sensor flow.
- SelectionMarkers already accepts hoveredAtom (v9 focus ring for free).
- CommandAction already has a shortcut field (the palette as keymap).
- The Expo shell already disabled back-swipe.

STILL UNVERIFIED (flagged in the ideas).
- iOS 26.5 DOM-tap haptics.
- role=slider as an atom cursor across NVDA, JAWS, VoiceOver and TalkBack.
- The iOS two-prompt sensor flow.
- WebGL2 node behaviour for the flash guard's reduction.
- getCoalescedEvents on Safari.
- Whether the trackpad-versus-wheel heuristic handles the Magic Mouse.

SOURCES:
- WCAG 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- Cooperative gestures: https://developers.google.com/maps/documentation/javascript/examples/interaction-cooperative
- MapLibre wheel heuristic: https://app.unpkg.com/maplibre-gl@3.4.0/files/src/ui/handler/scroll_zoom.ts
- iOS edge gestures: https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/
- Vestibular triggers: https://alistapart.com/article/designing-safer-web-animation-for-motion-sensitivity/ and https://webkit.org/blog/7551/responsive-design-for-motion/
- Spatial navigation: https://drafts.csswg.org/css-nav-1/
- Slider role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/slider_role
- 3D a11y precedent: https://modelviewer.dev/docs/ and https://scottvinkle.com/blogs/work/3d-model-accessibility
- Sensor permission: https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- Shake to Undo: https://github.com/reyramos/disable-shake-undo
- Android gesture defaults: https://developer.android.com/reference/android/view/ViewConfiguration

<a id="r2-play-for-everyone-01"></a>
## The Gesture Constitution: one arbiter, five laws, one intent bus
`R2-play-for-everyone-01` · foundation · effort M · judges mean **4.4** (E5 P4 A3 Pr5 M5; champion 4, keep 1) · self-scored fun 4 / visual 2 · perf improves

> Replace the recognisers that race each other on the canvas with one pointer arbiter. Five laws give every contested gesture exactly one owner, and touch, pen, mouse, trackpad, keys, buttons and the palette all share its intents.

**Framing:** problem->solution

**Builds on:** C009 wheel + C021 + C022 + C023 + C024 + C028 + C030 + C031 + C033 + C035 + C040 + C064 + C073 (arbitrates all of them)

**Problem:** Round 1 claims tap five ways (pick, poke, pluck, catch, hunt), double-tap four ways (glide, burst, zoom, shatter), long-press five ways (loupe, toy wheel, tug, lift, heat) and one-finger drag five ways (orbit, wake, knife, lasso, wipe). Two recognisers already race on the canvas today: drei OrbitControls (one-finger rotate, two-finger dolly-pan, touch-action none) and AtomPicker's click path (ViewerScene.tsx:680-760), which ray-marches on every mousemove and allocates a Vector3 per step (fact 35). There is no double-tap, no long-press and no catch. Every new toy would add another listener, mis-fires would compound, and nobody could test which gesture wins.

**Solution:**

1) One GestureArbiter owns the canvas container's pointer stream: setPointerCapture, pointercancel, and getCoalescedEvents where the browser has it. Nothing else listens to raw pointers on the canvas. OrbitControls is retired; the C003/C021 camera controller consumes intents instead of events.
2) A small state machine: Idle -> Down(target) -> Tap | DoubleTap | TapHoldSlide | LongPress | Drag(verb) | Multi(pinch/pan/twist/orbit). The thresholds live in one tokens file and are tuned by the playtest (idea 13): slop 8 CSS px for touch and pen, 3 px for mouse; double-tap within 300 ms and 32 px (Android's default); long-press at 450 ms (Android uses 400-500 ms, iOS about 500 ms); a tap catches when the spin is faster than 0.5 rad/s.
3) The target class (atom, empty or chip) is resolved at pointerdown. On v9 that is one SpatialHash DDA pick per pointerdown. On v10 it is C009's scissored 9x9 ID patch; its 1-2 frame async latency hides inside the slop window, because moves are buffered until the class resolves.
4) FIVE LAWS.
- L1 One finger orbits. In the default verb, a one-finger drag always orbits. No toy may take one-finger drag except through the Play chip (idea 3), with one stated exception: a full-frame frost reveal (C064).
- L2 Two fingers are always the camera. Pinch zooms, drag pans, and a twist rolls and springs upright on release (C021). While a Play verb owns one finger, a two-finger drag orbits instead of panning: the drawing-app convention, where one finger paints and two move the canvas.
- L3 Double-tap is always the camera, as in Maps and Photos. On an atom it glides and frames (C023); on empty space it zooms one step toward the point; double-tap-hold-slide zooms continuously; a two-finger tap zooms out one step. The burst (C030) leaves double-tap.
- L4 Long-press is precision, never play. On an atom (touch or pen) it opens the loupe: hold, slide, release to select (C024). On empty space, or with a right-click, it opens the Play tray as a context menu, replacing C009's radial wheel. Heat (C033) and tug (C031) never own long-press.
- L5 Prefixes are safe. Every gesture begins with a harmless action that fits how it ends, so nothing waits and there is no 300 ms tap delay. The first tap fires at once (pick plus tap response); a second tap upgrades it to a glide, and the same atom stays selected. A pointerdown during a coast catches immediately. A held finger changes nothing in the scene until 450 ms; only the touch mark (idea 14) fills.
5) TAP SEMANTICS, the most contested gesture:
- Tap while the molecule is coasting: catch only.
- Tap on an atom: select it AND play the tap response, so inspect and play are one event. The response is C073's pluck where modes are baked, C028's crisp ripple elsewhere, and one captioned plink.
- Tap whose fingertip patch holds 3 or more distinct atom IDs: ambiguous, so the loupe opens instead of guessing. On v9 this is approximated by counting front-layer atoms within the fingertip radius.
- Tap on empty space: deselect.
6) Every recognised gesture emits a semantic intent (camera.orbit, camera.glideTo, atom.select, atom.poke, verb.knife.stroke, play.reset, tray.open) on one IntentBus. Keys (idea 4), the atom cursor (5), tray buttons and switches (7), the Cmd/Ctrl+K palette's CommandAction list and toy demos all emit the same intents. A CI table asserts that every intent has at least one pointer path, one keyboard path and one button path, so WCAG 2.5.1 and 2.5.7 hold by construction.
7) MAPS.
- PHONE, default verb: drag orbits. Tap picks and plays; a tap while coasting catches; an ambiguous tap opens the loupe. Double-tap glides or zooms in; double-tap-hold-slide zooms. Long-press opens the loupe on an atom or the tray on empty space. Pinch zooms, with a rubber band and a scale card at the limits. A two-finger drag pans, a twist rolls, and a two-finger tap zooms out. Three or more fingers are never used (they're reserved for the OS and VoiceOver). Drags that start in the edge gutters are ignored (idea 2).
- PHONE, verb latched: one finger does the verb. Tug grabs only when the stroke starts on an atom; otherwise it orbits. Two fingers orbit and zoom.
- PEN (iPad Pencil): with a drawing verb latched, the pen does the verb while a finger still orbits, so there's no toggling. Pencil hover shows the mouse rim.
- MOUSE: left-drag orbits or does the verb. Hover shows C009's one restrained rim, with no radius swell. Click picks, and a click on a moving molecule catches. Double-click glides. The wheel zooms toward the cursor (C022). Right-drag, middle-drag or Shift+left-drag pans. A right-click that moves less than 3 px opens the tray at the cursor.
- TRACKPAD: click-drag orbits. Pinch (a ctrlKey wheel, or Safari gesture events) zooms toward the cursor. A two-finger swipe orbits: the OS momentum supplies the coast, and 120 ms after the stream stops the kernel settles into a detent. Shift plus two fingers pans. A two-finger click opens the tray.
- Trackpad versus wheel is classified once per session with MapLibre's documented heuristic, plus the rule that any deltaX means a trackpad. Settings can override it: Scroll = rotate or zoom. There is no universal convention (OrbitControls and Sketchfab zoom on scroll; Figma pans), so two-finger orbit is a declared bet that the playtest must confirm.

**Experience:**

Desktop: a drag spins the molecule and it coasts. A click on a spinning molecule catches it dead, a right-click opens Play, and the wheel zooms toward the cursor. On a MacBook, a two-finger swipe spins it like a globe.

Phone: the thumb spins it, a double-tap flies to an atom, a long-press shows the loupe, and a tap on a crowded lattice magnifies instead of guessing.

Keyboard, screen-reader and switch users reach the same intents through ideas 4, 5 and 7.

Reduced motion: taps give a highlight still with no ripple, and idea 10 governs the coast.

Phone budget: the arbiter is event-driven CPU and does no per-frame work at rest. A pick runs only on pointerdown, never on pointermove.

**Tech:**

DOM Pointer Events: setPointerCapture, pointercancel, and getCoalescedEvents where the browser has it.

math@0.1.0: vec2 for slop and velocity; spring and spring.dampAngle for coast and detents (C003).

Scheduler: @pmndrs/scheduler 0.2.0, 'input' phase, used on v9 and as v10's loop. Use named phases only, because numeric priorities run in reverse.

Picking:
- v9: SpatialHash3D grid DDA plus a hand-written ray-sphere test (math has none).
- v10: C009's RGBA8 ID target, drawn as a scissored 9x9 pass on pointerdown and read with readRenderTargetPixelsAsync.
- v10's pointerMap and userData.interactivePriority are used only for in-scene handles, not atoms.

Wheel classification follows MapLibre scroll_zoom (https://app.unpkg.com/maplibre-gl@3.4.0/files/src/ui/handler/scroll_zoom.ts). Timing defaults follow Android ViewConfiguration (https://developer.android.com/reference/android/view/ViewConfiguration).

**Backend:** DOM/CPU (arbiter, intents); picking [GPU+GL2] after R3/R6

**Rides (v10 requirements):** R7 (input phase); R2/R3/R6 for the ID patch; nothing for the v9 slice

**v9 slice:** The five laws, the tap semantics, double-tap glide (CameraFocus rewritten on spring3), rubber-band zoom and the intent bus all ship on v9. The CPU pick runs once per pointerdown instead of on every mousemove. On v9 the tap response is a SelectionMarkers ring pulse plus a plink; the ripple and pluck arrive with R3. No GLSL.

**WebGL2 fallback:** Same behaviour. The arbiter is DOM, and the RGBA8 ID patch reads back on the WebGL2 backend; C009's packing avoids implementation-defined integer readback. The thresholds are in wall-clock ms, so the 33 ms cadence of Low Power Mode doesn't change them.

**Where in code:**

- packages/ui/src/app/ViewerScene.tsx:680-760: AtomPicker and OrbitControls are replaced. Keep the onStart MOLECULE_INTERACTED analytics and the onEnd setCameraState.
- packages/scene/src/AtomPicker.tsx
- packages/scene/src/SpatialHash.ts: the query must stop allocating.
- packages/ui/src/CameraFocus.tsx: the per-frame lerps 0.14/0.07.
- New packages/ui/src/input/{GestureArbiter.ts, intents.ts, gestureTokens.ts}
- packages/ui/src/CommandPalette.tsx: CommandAction becomes an intent emitter.

**Risks:**

- Retiring OrbitControls touches saved-view camera state, analytics and the flythrough preview. XR keeps its own controls.
- Two-finger orbit on a trackpad breaks the scroll-to-zoom habit.
- The heuristic misreads some mice (a Magic Mouse sends small deltas), so the override setting must be visible.
- On older phones the async ID latency may exceed the slop window; the CPU pick stays as a fallback.
- L3 costs the playtester's favourite double-tap burst. The tray, shake and key paths must make the burst at least as findable, and idea 12 measures that.

**Honesty:** The arbiter only routes intents and moves nothing. Tap responses displace atoms only through the C027 offset layer, which the Play chip labels and deterministic export excludes.

**Judges:**

- E 5/champion: One pointer arbiter plus an intent bus closes round 1's most-flagged gap and ships entirely on v9. It retires OrbitControls, which C021's dt-correct controller needs anyway. Keys, buttons and switch access become the same intents, which makes accessibility nearly free. The risks are saved-view camera compatibility and trackpad scroll-zoom habits. *Improve:* Keep a compatibility adapter that writes the new controller's state into the existing saved-view camera fields. Put thresholds in one tokens file. Enable frameTimedRaycasts after v10.
- P 4/champion: Infrastructure, but it's what lets every toy coexist without mis-taps, and gesture ownership was round 1's number-one unowned gap. A tap that orbits, or a drag that pokes, destroys trust in two seconds. Retiring OrbitControls is the right call and the risky one. *Improve:* Ship the v9 arbiter with orbit, flick, tap and double-tap only. Publish every threshold as a tunable token, tune them in Couch Test, and absorb Edge-Safe Canvas as law zero.
- A 3/keep: Not a visual idea, but motion quality depends on it: recognisers that race each other are where jank and double responses come from. *Improve:* Add a feedback contract: every recognised gesture emits exactly one play-14 mark event.
- Pr 5/champion: This is the gap every judge named. Every toy, the replay log and every accessibility intent depends on one arbiter and one intent bus, and the slice ships on v9. The main scope risk is that retiring OrbitControls touches saved-view camera state. *Improve:* Migrate the saved-view camera schema with a compatibility test. Publish the intent table as the grammar document, owned by product.
- M 5/champion: One arbiter with pointercancel, capture and a single intent bus shared by touch, pen, keys, buttons and the palette is the precondition for every accessibility alternative. Without it, the verbs race each other and switch or voice intents have nothing to call. The v9 slice includes rubber-band zoom and the double-tap glide rewrite. *Improve:* Publish the thresholds as tokens tuned by PE-13. Expose every intent to assistive paths (PE-04, PE-07), keep double-tap-and-slide zoom compatible with iOS page zoom, and add a 'hold time' preference for users with tremor.

<a id="r2-play-for-everyone-02"></a>
## Edge-Safe Canvas: never fight the OS
`R2-play-for-everyone-02` · foundation · effort S · judges mean **3.6** (E4 P3 A2 Pr4 M5; champion 1, keep 3, merge 1) · self-scored fun 2 / visual 1 · perf neutral

> Let the OS keep the gestures it owns: gutters for back and home, no pull-to-refresh, no callouts, working page zoom, clean aborts, and cooperative gestures inside embeds.

**Framing:** problem->solution

**Builds on:** C109 (embeds) + C023 + C026 (safe areas and the sheet) + the Expo back-swipe decision; underpins the drag verbs C031, C035, C040 and C064

**Problem:**

Some gestures belong to the OS and a page cannot win them:
- overscroll-behavior and touch-action don't stop iOS Safari's edge back-swipe. The workaround, preventDefault on touchstart near the edge, is unreliable and fails during scrolling (pqina.nl).
- Chrome Android pulls to refresh.
- An iOS long-press raises callouts and the text magnifier.
- macOS Safari pinch-zooms the page through gesture events.
- The home indicator and VoiceOver have their own gestures.

Today OrbitControls sets touch-action none on the canvas, but html and body have no overscroll-behavior (global.css:100-113), and the canvas has no touch-callout or user-select rules. On an iPhone, a drag that starts 5 px from the left edge can become Back mid-orbit. The Expo shell had to disable back-swipe to keep horizontal drags (apps/mobile/README.md).

**Solution:**

S1 Gutters, not fights. The arbiter starts no one-finger gesture within 20 px of the left or right edge, or within max(safe-area-inset-bottom, 20 px) of the bottom. It ignores those touches rather than calling preventDefault, so back, forward and home behave as in every other app. No chip sits in a gutter. Since back is always one swipe away, the molecule, camera, look and Remix code live in the URL (the existing saved-view sync), and back then forward restores the view. The Expo WebView route (#/embed/mobile), which already disables back-swipe, sets the gutters to 0.

S2 Scroll physics, on the viewer route only.
- body.is-viewer gets overscroll-behavior: none, which kills pull-to-refresh and page bounce (Chrome, Safari 16+).
- The canvas container gets touch-action none, user-select none, -webkit-touch-callout none and -webkit-tap-highlight-color transparent.
- contextmenu is prevented on the canvas only, so a long-press there opens the Play tray, not 'Save image'.
- Panels keep overscroll-behavior: contain (global.css:1042) and normal touch-action.

S3 Never disable page zoom. Keep today's viewport meta, with no user-scalable=no (WCAG 1.4.4). A pinch on the DOM chrome zooms the page; a pinch on the canvas zooms the molecule. macOS Safari's gesturestart and gesturechange are prevented only when the target is the canvas.

S4 Yield cleanly. If pointercancel, visibilitychange, orientationchange or a visualViewport resize arrives mid-gesture, the gesture aborts: tug springs home, the knife heals, verbs release, and no capture is left stuck. The arbiter logs os_cancel for the playtest.

S5 Reserved gestures stay reserved: no three- or four-finger gestures (iOS undo, VoiceOver, system), no edge starts, and no touchstart preventDefault hacks.

S6 Cooperative mode for inline viewers (C109 embeds, and any future in-article canvas off /).
- Before wake, touch-action is pan-y pinch-zoom: one finger scrolls the page and two fingers orbit.
- The wheel scrolls the page unless Ctrl or Cmd is held.
- The first one-finger drag shows one line, 'Use two fingers to spin', following Google Maps' gestureHandling 'cooperative'.
- A tap wakes the full grammar, with a sleep button; scrolling it out of view puts it back to sleep.

S7 Screen reader on: VoiceOver and TalkBack own one-finger gestures. We never require passthrough; the atom cursor (idea 5) is the path.

S8 Safe areas. viewport-fit=cover is already set, and every chip uses env(safe-area-inset-*).

**Experience:**

It behaves like a phone app. A left-edge swipe goes back, a pull never reloads, a long-press never pops a save sheet, and a pinch on the header still enlarges text. On desktop, a trackpad pinch over the header zooms the page and over the molecule zooms the molecule. In an embed on a blog, the page keeps scrolling until you tap the molecule.

Reduced motion: nothing here moves.

Phone budget: CSS plus a few branches in the arbiter; no frames.

**Tech:**

- CSS: overscroll-behavior, touch-action, -webkit-touch-callout, env(safe-area-inset-*).
- Events: Pointer Events pointercancel, visualViewport resize, Safari GestureEvent.
- References: https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/ and https://developers.google.com/maps/documentation/javascript/examples/interaction-cooperative

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it ships on v9 now: CSS plus the arbiter's gutter tokens (S).

**WebGL2 fallback:** Doesn't depend on the renderer: the same on every backend and on old iPhones.

**Where in code:**

- apps/web/src/styles/global.css:100-113: a route-scoped body class, not a global rule, so / keeps scrolling.
- packages/ui/src/viewer/ViewerCanvas.tsx: container styles.
- packages/ui/src/input/gestureTokens.ts: gutters.
- The #/embed/mobile route flag.
- The embed route for C109.

**Risks:**

- The body class must be removed on route change, or the landing page loses its scroll bounce.
- 20 px gutters take about 10% of a 390 px-wide phone out of orbit starts. If strangers start drags at the edge, shrink them to 12 px.
- Behaviour differs in standalone PWAs and in some OEM Android browsers.
- Cooperative mode adds a little friction in embeds.

**Honesty:** Interaction plumbing only; outside every export.

**Judges:**

- E 4/keep: A small CSS-and-tokens fix that stops fighting OS back, home and pull-to-refresh. Ignoring gutter touches rather than calling preventDefault is the correct pattern. It costs nothing on any backend. *Improve:* Scope the body class to the viewer route and test removal in Playwright. Measure how many drags start inside the 20 px gutters before fixing the widths.
- P 3/merge: Nothing kills a flick faster than an accidental back-swipe or pull-to-refresh. It's cheap, v9 and necessary, but it's hygiene rather than play, and 20 px gutters cost orbit starts on small phones. Host: R2-play-for-everyone-01. *Improve:* Fold it into the arbiter, and measure how often drags start in the gutters (from gesture traces) before fixing the width at 20 px.
- A 2/keep: Outside my lens and sensible. *Improve:* The gutters must stay invisible: no chrome or guides drawn in them.
- Pr 4/keep: It is cheap, ships now, and prevents the phone rage-quits (back-swipe, pull-to-refresh, callouts) that kill activation. *Improve:* Ship it as a standalone CSS PR before the arbiter, and log how many drags start inside the gutters.
- M 5/champion: It stops Lupi fighting the OS: back-swipe gutters are ignored rather than prevented, pull-to-refresh is off, callouts are suppressed, page zoom keeps working, and embeds get cooperative gestures. It is small, v9, renderer-independent, and fixes the most common phone failure (the view reloads or navigates away mid-orbit). *Improve:* Remove the body class on route change, verify gutter widths against Android gesture navigation, and never disable pinch page zoom (WCAG 1.4.4) outside the canvas.

<a id="r2-play-for-everyone-03"></a>
## The Play Chip: one thumb, five verbs, one honest reset
`R2-play-for-everyone-03` · flagship · effort M · judges mean **4.2** (E4 P4 A4 Pr5 M4; champion 2, keep 3) · self-scored fun 4 / visual 3 · perf neutral

> One pill in the thumb zone opens every toy and switches what one finger does. The moment any atom is displaced, it adds 'Illustrative · Reset'.

**Framing:** problem->solution

**Builds on:** C009 (its wheel becomes the linear tray) + C027 (the chip is the Play control and the reset) + C029 + C030 + C031 + C033 (slider) + C035 + C040 + C064 + C019, plus the playtester's 'visible Play chip' fix

**Problem:** Toys are invisible. The only guidance is a text pill that vanishes on the first touch (ViewerGestureHint.tsx), and the best toys sit behind panels and modals (code-fun 6.1 #4). C009's long-press wheel was undiscoverable (playtester) and one of 'four feedback languages at once' (art director). Five drag toys want one finger. C027's 'illustrative motion' label had no home, and there was no one-tap 'put it back'.

**Solution:**

PLACEMENT: a 48 px pill in the thumb zone. On phones it sits bottom-right, above the command deck and the safe area; a left-handed setting mirrors it. On desktop it sits bottom-right of the canvas, beside Clear view. It is the only new persistent chrome.

STATES.
1) Rest: 'Play'. A tap opens the tray. A screen reader hears 'Play, menu, 14 things to try'.
2) Tray: a linear role=menu, not a radial wheel.
- Group 1, the one-finger verb, as a radio group: Orbit (default), Wake, Knife, Lasso, Tug, and Wipe when frost exists.
- Group 2, one-shot actions: Burst; Pluck where modes are baked (Ripple elsewhere); a Heat slider (role=slider, aria-valuetext '600 K, illustrative jiggle'); and Shake when sensors are on.
- Footer: Secrets found n/14 (idea 12), Sensors (8), Comfort (10).
- Each item shows a menu-scoped accelerator (K L W T B H P), active only while the tray has focus (WCAG 2.1.4).
- The tray also opens from a long-press or right-click on empty space, from the keyboard (idea 4) and from the palette.
3) Latched: the chip reads 'Knife' with a close button, the canvas gets a 2 px inset edge in the verb colour, and on desktop the cursor changes. One finger does the verb; two fingers orbit and zoom (law L2). Close, Esc or switching molecule returns to Orbit. So does 30 s without a verb stroke, with a polite 'Back to orbit'. This kills the classic 'the camera is broken' mode error.
4) Quasimode: press and hold the chip and the last verb is active only while held, while the other hand strokes. It can't strand you in a mode (Raskin's quasimode), and it is the tablet and expert path.
5) Displaced: whenever any C027 deformer amplitude exceeds epsilon, a second segment appears. The first time per session it reads 'Illustrative motion - your atoms haven't moved - Reset'; after that it is compact: 'Illustrative · Reset'. Reset springs every offset home on the 'settle' token; under reduced motion it cuts to the true pose in one still. A screen reader hears 'Reset illustrative motion; active: knife cut, 2 ripples'. The segment is bound to the offset registry, not to toys, so the honesty label is structural: while any atom is displaced, the word is on screen.

VERB RULES.
- Tug grabs only when the stroke starts on an atom; on empty space it orbits, so leaving Tug latched is safe. Two fingers on two atoms = taffy (C031 phase 2).
- Knife: one stroke = one plane; the halves heal on the spring (C035).
- Lasso: a closed stroke selects and draws the hull. 'Cut out' is a separate button on the result card, labelled 'derived, unrelaxed, cut from an ideal lattice' (C040's fix).
- Wake: C029's wake.
- One exception: during a full-frame frost reveal (reworked C064 as the Frost Reveal Daily), Wipe latches automatically while at least 40% of the frame is fogged, because orbiting an invisible molecule is pointless. The chip reads 'Wipe · Clear', and Clear is the keyboard and switch path.

INVITATION: the chip condenses in on C030's token after the first successful orbit. After 15 s of orbit-only play it breathes once; it never loops (WCAG 2.2.2).

**Experience:**

Phone: the right thumb taps Play, then Knife, then swipes. The molecule splits and heals, and the chip shows 'Illustrative · Reset'. On a tablet, the left thumb holds the chip while the right hand slices.

Desktop: click Play, press K, drag.

Keyboard: Tab to Play, Enter, arrows, Enter.

Screen reader: a menu of radio items, each saying what it does and naming its non-drag alternative (idea 7).

Reduced motion: Reset is a single cut still.

Phone budget: a DOM pill on compositor transforms, adding no canvas frames at rest. Verbs carry their own settle contracts (idea 11).

**Tech:** React DOM, with the existing LupiActionButton and usePressSpring for press feel. iOS haptic ticks are allowed here because these are direct DOM taps; that is the iOS 26.5 rule, not yet verified on a device (https://haptics-web.vercel.app/). math@0.1.0 spring drives chip transitions on C003 tokens. The C027 deformer registry exposes the 'any displaced' state. Forced colours: system colours (ButtonText, Highlight) plus an outline. prefers-reduced-transparency makes the pill opaque.

**Backend:** DOM/CPU (chip); the verbs are [GPU+GL2] after R3/R4

**Rides (v10 requirements):** R3/R4 via C027 for the Displaced state and the verbs; the chip itself rides nothing

**v9 slice:** The chip and tray, offering only the toys v9 can honestly run: Orbit; Burst/condense on the existing uProgress hook (the engineer's zero-GLSL slice, with no stagger); Lasso (C040's DOM/CPU selection with SelectionMarkers); tap-to-trail (C065); Remix; and Reset, which zeroes uProgress. The Displaced segment reads uProgress != 0, and ExportManager must reset it before any V1 capture. No new GLSL.

**WebGL2 fallback:** Same chip. On the WebGL2 backend, [GPU]-only extras such as snow piling show 'lite on this device' instead of vanishing. In Low Power Mode, verbs keep working with shorter settles.

**Where in code:**

- New packages/ui/src/play/{PlayChip.tsx, PlayTray.tsx, verbs.ts}, mounted in packages/ui/src/ViewerApp.tsx near Clear view (ViewerApp.tsx:778-798).
- A store slice for playVerb.
- Retires packages/ui/src/app/ViewerGestureHint.tsx.
- Phone deck placement: apps/web/src/styles/global.css:1156-1224.

**Risks:**

- Persistent chrome on a calm viewer. Keep it to one pill, and let Clear view stow it.
- The latched edge may be too subtle; the playtest measures this as mode errors.
- Tray creep: at most 7 items per group, and a new toy replaces one or goes under More.
- On phones the chip competes with the bottom deck.
- The 30 s auto-revert could surprise someone who paused mid-task, so it is announced and one tap undoes it.

**Honesty:** The chip is the honesty label. It shows 'Illustrative' in words whenever any atom is displaced, and Reset is always one tap away. Neither the chip nor the offsets reach deterministic export (C027's byte-identical export test).

**Judges:**

- E 4/keep: One thumb-zone pill that switches the one-finger verb and doubles as the 'Illustrative · Reset' control is the right discoverability primitive. The v9 tray offers only toys v9 can honestly run. It is DOM only. *Improve:* Choose one home for Illustrative/Reset: this chip or cross-09's capsule, not both. Cap the tray at 7 items per group.
- P 4/champion: The discoverability hub: a pill labelled Play is an invitation any stranger understands, and making the 'illustrative' badge the one-tap reset is elegant. Risks: latched verbs cause mode errors, the tray creeps, and a second pill (Status Island) competes for attention. *Improve:* Keep one pill in total: absorb Status Island's morphing states and the Context Deck's ordering. Auto-unlatch a drag verb after one use or 10 s idle. The tray's first row should be the three most fun toys from playtests, not a radio group of drag verbs.
- A 4/keep: One pill in the thumb zone that Clear view stows is real restraint. Putting 'Illustrative · Reset' on the same pill avoids a second capsule. *Improve:* Absorb cross-09's live states into this pill. Set a canvas chrome budget of at most one persistent pill plus one transient overlay, and morph on the snap token.
- Pr 5/champion: Toys nobody can find don't exist. One pill that also reads 'Illustrative · Reset' makes honesty the Play control. But Play is a new viewer control outside the contract's list (Learn, Style, Data, Camera, Export, Elements), so it needs an explicit amendment. It hosts Status Island. *Improve:* Get the contract amendment first. Make this the only new persistent chrome, morphing for live state as Status Island proposes, with at most 7 tray items.
- M 4/keep: A linear role=menu instead of a radial wheel is screen-reader friendly. A left-handed mirror, 'lite on this device' instead of silently vanishing, and the Illustrative · Reset state as the one-tap safety net are all right. *Improve:* Share one live-state surface with CS-09 so there are not two pills, keep the chip out of PE-02's gutters with a 48 px target, and let Clear view stow it without losing Reset.

<a id="r2-play-for-everyone-04"></a>
## Scoped Keys: a keyboard map that never steals
`R2-play-for-everyone-04` · system · effort S · judges mean **3.4** (E4 P3 A2 Pr3 M5; champion 1, keep 4) · self-scored fun 3 / visual 1 · perf neutral

> Three focus scopes (Scene, Atom cursor, Play tray) and one generated help sheet. Arrows turn the molecule by detents, letters act only where focus is, and frame-stepping moves to , and .

**Framing:** problem->solution

**Builds on:** C021 (arrows step detents) + C023 (Home, zoom) + C031 (Shift+arrows tug) + C033 (Heat slider keys) + C035 (X/Y/Z plane presets) + C040 (keyboard shape presets) + C064 (Enter wipes a stripe) + C009 (the tray replaces the wheel)

**Problem:** The viewer has no keyboard camera control. Bare ArrowLeft and ArrowRight already step trajectory frames globally (useGlobalShortcuts.ts:25-26), which collides with C021's 'arrows step detents'. The bare single-letter globals (v, x, b, t and 1-7) fire whenever focus is on the body: that fails WCAG 2.1.4, and it collides with any 'P plucks' or 'K knife'. There is no help sheet, so keyboard play is invisible.

**Solution:**

SCOPE A, Scene. The canvas region is one tab stop (tabindex 0) with a visible focus ring. It is a role=application region with aria-roledescription '3D molecule viewer' and an aria-label that names the keys; the canvas element itself is aria-hidden. This is the pattern model-viewer uses for arrow-key orbit with orientation announcements.
- Arrows orbit one 15 degree step and settle into C021's hero-angle detents; Shift+arrows take 3 degree fine steps. Under reduced motion each step is a cut.
- + and - zoom one step. Home fits and resets the view. R resets illustrative motion.
- , and . step trajectory frames (YouTube's convention). Space plays and pauses, as today.
- Enter moves into the Atom scope, on the most central heavy atom.
- ? opens Controls and Secrets (idea 12).
- Esc closes panels, then leaves the scope.
- Each orbit step is announced after it settles ('upper-front view').

SCOPE B, Atom cursor (idea 5).
- Arrows move the cursor through space. ] and [ go to the next and previous bonded neighbour. E and Shift+E jump between atoms of the same element.
- Enter pokes; P plucks; Shift+arrows tug (one nudge per press, springing home on release).
- S selects and shows the card; F glides the camera to the atom; Esc returns to Scene.

SCOPE C, Play tray: arrows, Enter, and the letter accelerators K L W T B H P live only inside the menu.

VERB KEYS inside a latched verb:
- Knife: X, Y or Z places a plane through the focused atom, and the arrows step it one lattice plane at a time.
- Lasso: the arrows grow or shrink a sphere or slab around the focused atom.
- Heat: the arrows move 100 K per step.

MIGRATION. v, x, b, t and 1-7 become Scene-scope keys, so they still work where people actually use them. A Settings switch, 'Single-key shortcuts on/off', covers WCAG 2.1.4. The PlaybackScrubber keeps its own arrows. Returning trajectory users see one toast: 'Arrows now turn the molecule; , and . step frames'.

PALETTE. Every intent registers a CommandAction with its shortcut (the type already has a shortcut field), so Cmd/Ctrl+K doubles as a searchable keymap ('burst', 'knife x', 'heat 800 K', 'reset motion'). These are UI intents only, not additions to the 31-tool MCP manifest.

HELP. ? opens a sheet generated from the idea-1 intent table, grouped by scope, listing touch, mouse/trackpad, key and button paths side by side.

**Experience:**

Desktop: Tab lands on the molecule. The right arrow clicks it round a detent with a tick. Enter drops into atom mode, and P makes it ring.

An iPad with a keyboard uses the same map.

Screen reader: Scene announces the orientation after each step, and each scope is announced on entry.

Phone budget: one step is one spring settle, then the demand frameloop sleeps.

**Tech:**

- DOM keydown, routed by closest('[data-key-scope]'), with a roving tabindex and the idea-1 intents.
- math@0.1.0 spring.dampAngle for detent steps (C003).
- The existing CommandAction.shortcut field.
- Precedent: https://modelviewer.dev/docs/ (a11y orientation strings).
- Rule: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it on v9 (S). Verb keys appear as their verbs ship.

**WebGL2 fallback:** Doesn't depend on the renderer.

**Where in code:**

- packages/ui/src/app/useGlobalShortcuts.ts:25-71: the arrows and the single-letter globals.
- packages/ui/src/viewer/ViewerCanvas.tsx: the focusable, labelled region.
- packages/ui/src/CommandPalette.tsx: CommandAction.shortcut.
- packages/ui/src/app/PlaybackScrubber.tsx
- New packages/ui/src/input/keymap.ts

**Risks:**

- Changing what the arrows do breaks muscle memory for trajectory users. Research files, which already have an isResearch path, may keep arrows as frame keys; the playtest settles this per-file default.
- role=application is contentious. It suits a real viewport, but NVDA, JAWS and VoiceOver behaviour must be verified with users (idea 13).
- Scopes are invisible unless they are announced and outlined.

**Honesty:** Key-driven toys announce 'illustrative' just like their pointer versions, and Reset is on R.

**Judges:**

- E 4/keep: Three scoped focus regions with a generated help sheet follow model-viewer's proven pattern. Small and renderer-agnostic. *Improve:* Keep arrows as frame keys on research/trajectory files through the existing isResearch path.
- P 3/keep: Arrow keys stepping between detents is a real laptop pleasure, proven by model-viewer, and scoped focus stops keys being stolen. *Improve:* Make each arrow step click with the same tick and chord as flick detents, so keyboard play gets the same juice.
- A 2/keep: Outside my lens. Arrows that step between detents help composition. *Improve:* Arrow steps should land on fm-05 detents, not fixed 15° increments.
- Pr 3/keep: Necessary keyboard hygiene, with model-viewer as precedent. Turning the arrows from frame stepping into orbiting will break trajectory users' habits. *Improve:* Default the arrows per file through isResearch, and ship with the generated help sheet.
- M 5/champion: Verified in the repo: useGlobalShortcuts binds Space and 1-7 document-wide, and the arrows step frames, which fails WCAG 2.1.4 Character Key Shortcuts for speech users, and there is no keyboard camera control at all. Three scopes, a model-viewer-style application region and a generated help sheet fix both. S effort, on v9. *Improve:* Keep research files on frame arrows via the existing isResearch path, and add a setting to remap or turn off single-key shortcuts. Announce the orientation after each arrow step, as model-viewer does.

<a id="r2-play-for-everyone-05"></a>
## Atom Cursor: walk the molecule by keyboard and screen reader
`R2-play-for-everyone-05` · system · effort M · judges mean **3.8** (E4 P3 A3 Pr4 M5; champion 1, keep 4) · self-scored fun 3 / visual 2 · perf neutral

> A roving, announced cursor over atoms, driven by SpatialHash. Arrows move through space and brackets walk the bonds. VoiceOver and TalkBack users swipe up and down through a bond-ordered tour ('Oxygen 3, bonded to C2 and H7') and can poke, pluck and tug from the keys.

**Framing:** problem->solution

**Builds on:** C009 (rim, ID visibility) + C028 (Enter pokes) + C073 (P plucks) + C031 (Shift+arrows tug) + C023 (F glide) + C024 (a precise select without a loupe) + C091 (hunts become keyboard-playable)

**Problem:** The molecule is an unlabelled canvas: ViewerCanvas.tsx renders <Canvas id='lupi-viewer-canvas'> with no name or description, so a screen-reader user hears nothing. Picking is pointer-only (AtomPicker.tsx), so a keyboard user can't reach a single atom, and every toy that starts with 'tap an atom' is out of reach. Only 2 of 180 round-1 ideas mentioned screen readers.

**Solution:**

(1) The scene speaks. The Scene region (idea 4) carries a live accessible name, 'Caffeine, C8H10N4O2, 24 atoms, front view. Press Enter to explore atoms.', and an aria-describedby summary: element counts, rings, largest extent ('about 1.1 nm across') and active toys. It is built from frame data, with no network call. The canvas itself is aria-hidden.

(2) The cursor is one focusable widget: role=slider, aria-roledescription 'atom cursor', aria-valuemin 1, aria-valuemax N, aria-valuenow set to the traversal index, and aria-valuetext set to the announcement. That is the adjustable pattern: VoiceOver and TalkBack users swipe up and down to step between atoms (VoiceOver prompts 'swipe up or down to adjust'), and desktop screen readers switch to focus mode, so our keys arrive.

(3) Four traversals.
- Spatial, for sighted keyboard users: an arrow picks the next atom in that screen direction using the CSS Spatial Navigation distance (euclidean plus weighted orthogonal displacement, minus alignment). Candidates are the SpatialHash3D neighbours of the current atom projected to the screen, front-most preferred, at most 64 per step, so it stays O(1) at 1M atoms.
- Bond walk: ] and [ cycle through bonded neighbours.
- Element jump: E and Shift+E, like a VoiceOver rotor.
- The adjustable order, for swipe up and down: breadth-first along bonds from the most central heavy atom, so consecutive atoms are neighbours, which makes sense to a listener. Lattices fall back to a layer-by-layer sweep.

(4) Announcements: one polite, coalesced message per settle, in the form '{Element} {ordinal}, bonded to {C2} and {H7}, {front-left, upper}', plus any toy state ('rippling, illustrative'). Big lattices get counts, not names: 'Copper, 12 neighbours, interior, layer 14 of 40'. Ordinals follow file order per element (O3 is the third oxygen), so they are stable across sessions.

(5) Touch screen readers: while the cursor is focused, the AtomInfoHUD card adds neighbour buttons ('Go to C2', 'Go to H7') that a VoiceOver swipe-right reaches. They double as a sighted 'bond hop' for touch.

(6) Actions.
- Enter pokes (C028's ripple).
- P plucks with C073 where modes are baked. Elsewhere it says 'No baked modes for caffeine; rippling instead'.
- Shift+arrows tug 0.2 Å per press along screen axes and spring home on release. This is a display offset, announced 'pulled 0.4 Å, illustrative'.
- S selects.
- F glides the camera to the atom within the comfort caps (idea 10); under reduced motion it is a cut.
- Esc leaves.

(7) Visuals. A 'focused' bit in the R2 flag byte draws C009's single restrained rim in the key-light colour, at 3:1 contrast or better against the backdrop. An atom that leaves the view triggers a minimal glide. Mouse and touch users can press an arrow after a tap-select to continue from that atom.

**Experience:**

Keyboard: Tab to the molecule and press Enter; a rim lands on the central carbon. Arrows hop visibly, ] walks round the ring, and P rings it.

VoiceOver on an iPhone: swipe to the cursor, then swipe up: 'Nitrogen 1, bonded to C2, C5 and C8, upper left'. Swipe right to reach 'Go to C2'.

Sighted phone users get the same neighbour buttons on the atom card and hop round the ring by tapping.

Reduced motion: a highlight still for a poke, and a cut for glides.

Phone budget: CPU hash queries only on a key press or swipe, and one demand frame per move.

**Tech:**

SpatialHash3D (packages/scene/src/SpatialHash.ts), plus a new kNearest that doesn't allocate (today's query allocates and sorts).

Bonds come from the CPU worker's topology. Above 200k atoms, where bond detection is forced onto the GPU, the focused atom's neighbours are found locally with the same covalent-cutoff rule and announced as inferred.

@atlas/core resolveTypeLabel and ELEMENT_DATA; math@0.1.0 mat4 and vec3 for projection into scratch tuples; one aria-live region. v10 adds the R2 flag-byte 'focused' bit (inference: the 4th byte is free) and a visibility check against C009's ID buffer.

References: https://drafts.csswg.org/css-nav-1/ , https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/slider_role , https://scottvinkle.com/blogs/work/3d-model-accessibility

**Backend:** DOM/CPU; rim [GPU+GL2] on v10

**Rides (v10 requirements):** R2 (flag-byte rim), R3 (poke ripple); v9 needs none

**v9 slice:** Everything except the shader rim and the ripple. SelectionMarkers already accepts hoveredAtom, so it draws the focus ring. On v9, Enter pokes as a ring pulse plus a plink; P and Shift+arrows arrive with R3. Nothing is displaced on v9, so V1 export is untouched.

**WebGL2 fallback:** Same: the traversal runs on the CPU, and the RGBA8 flag byte and ID patch work on the WebGL2 backend.

**Where in code:**

- New packages/ui/src/a11y/{AtomCursor.tsx, describeMolecule.ts, traversal.ts}
- packages/ui/src/viewer/ViewerCanvas.tsx: the labelled region; the canvas is aria-hidden.
- packages/ui/src/AtomInfoHUD.tsx: neighbour buttons.
- packages/ui/src/SelectionMarkers.tsx: the focus ring.
- packages/scene/src/SpatialHash.ts: kNearest without allocation.

**Risks:**

- A slider role for something that isn't a scalar is a stretch. aria-roledescription support varies, and 'slider' may confuse some users, so test with real screen-reader users.
- Announcements can be verbose; offer a 'brief' setting.
- Large lattices need summarised speech.
- Inferred bonds can be wrong for distorted MD frames, so the cursor must say 'inferred'.
- Focus-mode behaviour differs between NVDA, JAWS and VoiceOver.

**Honesty:** Bonds are announced as inferred when the topology is inferred (the bridge already reports bondTopology 'inferred'). Poke, pluck and tug are spoken as illustrative. Source atoms never move, and nothing enters deterministic export.

**Judges:**

- E 4/keep: A roving, announced atom cursor over SpatialHash is the missing screen-reader path. A non-allocating kNearest also fixes a CPU hotspot. It works on v9 through SelectionMarkers' hoveredAtom. Above 200k atoms, neighbours from the GPU bond path need a CPU fallback. *Improve:* Use distance-based neighbours when topology is GPU-only, and test the slider role with real screen-reader users.
- P 3/keep: Essential access work, and a surprising delight for sighted keyboard users who walk the bonds. It isn't phone play. *Improve:* Share the cursor with Hide an Atom and Bond Walk Radio so it earns its keep in games.
- A 3/keep: The cursor's focus rim risks becoming yet another ring style alongside hover, selection and loupe snap. *Improve:* Share one hover and selection signature with C009, pk-02 and sig-05's labels.
- Pr 4/keep: A real differentiator. Mol*, 3Dmol and PhET 3D scenes are close to opaque to screen readers, accessibility is a procurement gate for schools, and the contract names accessibility as owned. It hosts Bond Walk Radio. *Improve:* Test with paid screen-reader users before launch, and compare an application or listbox pattern against the slider role.
- M 5/champion: The first real screen-reader path into the molecule: a scene description built from frame data, a roving announced cursor, bond-ordered traversal and poke/pluck/tug from keys. It is CPU/SpatialHash, so it is identical on GL2 and v9. *Improve:* Test role=slider against VoiceOver (swipe-to-adjust is an asset) and TalkBack (adjust gestures differ). Rate-limit announcements through one announcer, and cap traversal announcements for 5M-atom scenes to a summary.

<a id="r2-play-for-everyone-06"></a>
## Bond Walk Radio: play the molecule by ear
`R2-play-for-everyone-06` · science-toy · effort S · judges mean **3.2** (E3 P3 A3 Pr3 M4; keep 4, merge 1) · self-scored fun 4 / visual 2 · perf neutral

> The atom cursor becomes an instrument. Every step plinks at its element's note, panned to where the atom sits; bonds become intervals; closing a ring plays its chord; and baked molecules sing their real modes.

**Framing:** capability->problem

**Builds on:** C041 + C093 (mass-pitched plinks, folded) + C073 (real mode pitches) + C088 (Daily format) + idea 5 (atom cursor)

**Problem:** The grammar has a hole: every round-1 toy is visual-first. A blind visitor, or anyone playing with the phone face-down, has nothing to play with. Keyboard walking (idea 5) is useful but not yet fun. The mobile judge noted that C073's audio is the one toy blind users could enjoy, but it needs a pointer tap.

**Solution:**

(1) Each cursor step plays a 90 ms plink on the element's note, from C041's vocabulary (heavier = lower). The notes come from one pentatonic set, so any walk sounds consonant and C, N, O and H are clearly distinct. A StereoPannerNode pans by the atom's screen x, and buried atoms play quieter.
(2) Bond order becomes an interval: single = repeated unison, double = up a fifth, triple = up an octave. The mapping is illustrative and is captioned once.
(3) Ring closure: stepping back onto an atom already visited in this walk plays a chord of the ring's elements and says 'Ring closed: 6 atoms'. A local depth-first search over the bond graph finds cycles of up to 8 atoms. This is something only a molecule graph can do.
(4) Branching rhythm: an atom with 3 or 4 neighbours plays a quick grace-note roll, one note per neighbour, so branch points are audible.
(5) 'Listen to it' in the Play tray plays the canonical traversal as a 6-10 s melody while the rim follows along: one note per atom up to 64 atoms, then a summary by element. The camera never moves.
(6) The real layer: on the curated baked molecules (C073's manifest), P plays the focused atom's largest-amplitude real normal mode, transposed down 37 octaves. Captions keep the two kinds of pitch apart: 'element note, illustrative' versus 'mode 14, 1650 cm-1, real, transposed'.
(7) A small untimed game, 'close the ring with your eyes shut': seeded with mulberry32 and counted in steps, not seconds (WCAG 2.2.1). It can be one of the Daily's rotating formats.
(8) Every cue has a caption in the atom card, so deaf players can see what played.

**Experience:**

Keyboard: Enter, then ] ] ] ] ] ]. Each step plinks, then the ring chord plays and a voice says 'Ring closed: 6 atoms, aromatic ring'.

VoiceOver on a phone: swipe up and hear speech plus the note. The cues are short and quiet, so speech stays clear.

Sighted phone: tap an atom, then tap the neighbour buttons to hop and hear it.

Desktop with headphones: stereo placement tells you where each atom sits.

Reduced motion: sound is unchanged and the rim moves without a camera move.

Phone budget: Web Audio on one shared context and one demand frame per step.

**Tech:**

Web Audio on the shared AudioContext from C041: OscillatorNode or ZzFX-style synthesis, plus StereoPannerNode. iOS mutes Web Audio with the ringer switch, so the captions carry the meaning.

math@0.1.0 mulberry32 seeds the challenge. The ring search is a DFS over the local bond graph. Real frequencies come from C073's modes manifest (method, version, scaling).

**Backend:** DOM/CPU

**Rides (v10 requirements):** none; the real-mode pitches need C073's offline bake

**v9 slice:** All of it on v9, on top of the idea-5 cursor: element notes, intervals, rings and captions. Real modes arrive when C073's bake exists; that is data only, no GLSL.

**WebGL2 fallback:** Doesn't depend on the renderer.

**Where in code:**

- packages/ui/src/lib/clickSound.ts, which grows into the cue bus.
- New packages/ui/src/play/bondWalkAudio.ts
- Events from packages/ui/src/a11y/AtomCursor.tsx.
- Captions in packages/ui/src/AtomInfoHUD.tsx.

**Risks:**

- The sound default is unresolved (C041: opt-in, or on after the first gesture). This toy should start sound only from its own explicit Listen action.
- Cues can collide with screen-reader speech, and the page can't detect when VoiceOver is speaking; keep cues short and quiet.
- People may mistake the pitches for spectroscopy; the captions address this.
- The iOS silent switch mutes everything.

**Honesty:** Element notes and bond intervals are an illustrative sonification, and the captions say so. Only C073's mode pitches are real data: transposed 37 octaves, with a provenance manifest. Nothing reaches export.

**Judges:**

- E 3/keep: Cheap DOM audio on top of the atom cursor, with a real accessibility payoff. It is niche and adds another sound surface to keep consistent. *Improve:* Implement it as Sound Kit (joy-09) patches, and start it only from its own Listen action.
- P 3/keep: Walking a molecule and hearing ring closures as chords is a lovely instrument, especially for blind players, but sighted phone users will never find it behind a keyboard cursor. *Improve:* Expose a touch 'walk' mode from the Play tray (tap to hop along bonds), or fold it into Music Box as its walk variant.
- A 3/keep: Audio-first with no cost to the canvas. The pentatonic set keeps any walk from sounding ugly. *Improve:* Share voices with joy-09 and add no new visual layer.
- Pr 3/merge: Merge into R2-play-for-everyone-05. It is lovely sonification for the cursor, but niche, and it depends on the unresolved sound default. *Improve:* Ship it as the cursor's optional Listen mode.
- M 4/keep: Blind players get a toy that is not a consolation prize. It starts only from its own Listen action and has captions. *Improve:* Duck cues under screen-reader speech, provide a mono mode (the pan must not carry meaning for hearing-aid or single-ear users), and note that the iOS ringer mutes Web Audio.

<a id="r2-play-for-everyone-07"></a>
## Every Verb Without a Drag, a Hold or a Clock: switch, voice and dwell play
`R2-play-for-everyone-07` · system · effort M · judges mean **3.0** (E3 P2 A2 Pr3 M5; keep 3, merge 2) · self-scored fun 3 / visual 1 · perf neutral

> Each verb gets button alternatives: knife plane presets, lasso shape stamps, a tug d-pad, heat notches. Add dwell safety, labels that voice control can say, and a one-switch demo mode, so switch, voice and eye-tracking users get the same toys.

**Framing:** problem->solution

**Builds on:** C031 + C033 + C035 + C040 + C064 + C091 + C074 (untimed) + C043/C028 shake + C009 (a linear tray, not a radial wheel)

**Problem:**

Five verbs are drags (knife, lasso, wake, tug, wipe) and two are holds (heat charge, the loupe). Several games are timed (C091 hunts, the C074 speedrun), and shake and tilt need a body that can shake a phone.

The users who can't do those:
- iOS Switch Control and Android Switch Access scan focusable elements. Their point scanning can tap but can't draw.
- Voice Control users say 'tap Burst'.
- iOS 18 Eye Tracking works by dwell.

The rules involved: WCAG 2.5.1 (path gestures), 2.5.7 (dragging), 2.5.4 (motion actuation), 2.2.1 (timing), 2.5.3 (label in name) and 2.5.8 (target size).

**Solution:**

Every verb declares altActions in its toy manifest (idea 11), and CI fails a verb that has none.

PER-VERB ALTERNATIVES.
- Knife: 'Cut' with an X, Y or Z view-relative plane through the focused or central atom; 'Nudge plane' back and forward buttons that step one lattice plane or 0.5 Å; 'Heal'.
- Lasso: 'Select around focused atom' with +/- radius and a sphere or slab shape; 'Select this element'; 'Select ring'.
- Tug: a four-way pad that nudges the focused atom, and 'Let go'.
- Wake: 'Sweep' plays one pass across the view (a single still under reduced motion).
- Wipe: 'Clear frost', plus 'Wipe a stripe', which clears one band per activation so it stays a game.
- Heat and Burst: +/- 100 K notches instead of a hold. When the molecule is hot, Burst becomes 'Release', so the playtester's charge-and-release is two taps.
- The loupe needs no alternative: the atom cursor (idea 5) is the precise path.
- Shake and tilt: the Shake button and the tilt pad (idea 8). Sensors switch off in one tap.

TIMERS. Every timed game has an untimed Zen variant. Zen is the default under reduced motion or with Settings > No timers. Hunts count taps, not seconds.

DWELL SAFETY. Hover and dwell only ever show the rim. No toy action or destructive action fires from gaze or hover alone, and no menu closes itself.

VOICE. Visible labels match accessible names ('Burst', 'Knife', 'Reset motion'). Icon-only buttons are banned in the tray. Every control is a real button, so numbered overlays work.

SCANNING. Groups hold at most 7 items, most-used first (Burst, Pluck, Reset), and nesting goes at most 2 levels deep. Targets are at least 44x44 CSS px. The Play chip comes right after the canvas in the scan order.

ONE-SWITCH MODE (Settings). Each activation of the chip performs the next action in a curated demo loop (burst, reset, pluck, knife X, heal, lasso ring, clear), so a single switch still gets a toy.

**Experience:**

A switch user scans to Play, then Knife, then X, then Nudge, Nudge. The molecule splits along a lattice plane and heals.

Voice: 'Tap Burst', then 'Tap Reset motion'.

Eye tracking: dwelling on Burst bursts it once; gazing at the molecule only highlights it.

Pointer users benefit too: a knife plane that snaps to a lattice plane is more satisfying than a wobbly swipe.

Reduced motion: each alternative produces one still.

Phone budget: DOM buttons issuing the same intents, one settle per action.

**Tech:**

- DOM buttons emitting idea-1 intents, declared in the toy manifest's altActions.
- math@0.1.0 plane3 for the preset planes.
- Lattice-plane stepping from LATTICE_BASIS for procedural lattices.
- WCAG references: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html , https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html , https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html

**Backend:** DOM/CPU (verbs keep their own backends)

**Rides (v10 requirements):** The verbs ride R3/R4; the alternatives ride nothing.

**v9 slice:** Tray buttons for the v9 toys (uProgress burst and condense, Lasso stamps, Remix); the Zen default for the DOM Daily (C088); and the one-switch demo loop over v9 toys.

**WebGL2 fallback:** Same: buttons don't care about the backend.

**Where in code:**

- packages/ui/src/play/{verbs.ts, PlayTray.tsx}
- Store settings: noTimers, oneSwitch.
- tests/ui/: a new keyboard-only and axe-core spec.
- packages/core lattice basis for plane stepping.

**Risks:**

- Tray bloat.
- The alternatives must be fun rather than a consolation prize; test them with switch users.
- Keeping parity as toys multiply relies on the CI gate.
- The one-switch loop needs curating per molecule.

**Honesty:** The alternatives carry the same 'illustrative' captions and the same Reset. The lasso's Cut out keeps its 'derived, unrelaxed' provenance label.

**Judges:**

- E 3/keep: A CI gate that fails any verb without altActions is the right enforcement. The alternatives themselves (plane presets, stamps, d-pad) are cheap DOM, but tray bloat is real. *Improve:* Declare altActions in the single ToyManifest (play-11/port-08) and playtest them with switch users before building more.
- P 2/merge: The right requirement (a button alternative for every verb), but it's a policy, and 'the alternatives must be fun' isn't designed. Host: R2-port-as-toy-engine-08. *Improve:* Make altActions a required manifest field, and scope the one-switch demo loop as an opt-in attract mode.
- A 2/keep: Outside my lens. *Improve:* The alternative-action buttons should use the tray's chip style rather than a separate button language.
- Pr 3/merge: Merge into R2-play-for-everyone-11. It is the right WCAG 2.5.x compliance, and it belongs in the toy contract. *Improve:* Make altActions a required manifest field, enforced by CI.
- M 5/keep: Button alternatives for every drag verb are WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) compliance, not polish. Dwell safety, voice-sayable labels and a one-switch demo mode are rare and right, and CI fails any verb with no alternative. *Improve:* Merge its altActions into PE-11's manifest as a required field. Test with switch and voice-control users, make dwell times configurable, and make sure no alternative is timed.

<a id="r2-play-for-everyone-08"></a>
## One Sensor Door: a single opt-in, a visible 'Sensors on', and a button for every shake
`R2-play-for-everyone-08` · system · effort S · judges mean **3.4** (E4 P3 A2 Pr3 M5; keep 2, merge 3) · self-scored fun 3 / visual 1 · perf improves

> Generalise GPU Studio's enablePhoneSnow into one SensorHub. It has one explicit toggle and a 'Sensors on' pill that switches it off. It turns itself off by rule, gives every sensor verb a Shake button or tilt pad, and guards against iOS Shake-to-Undo and vestibular tilt.

**Framing:** problem->solution

**Builds on:** C025 + C028 (shake; tilt sag dropped per the art director) + C030 (shake to burst) + C042/C043 (snow) + C062 (shake to remix, as secondary) + the existing enablePhoneSnow

**Problem:**

Round 1 implies a permission prompt per toy: shake to burst (C030), wobble (C028), tilt sag (C028), a tilt window (C025), shake for snow (C043) and shake to remix (C062). The only flow today, enablePhoneSnow (snow-motion.ts:43-124), is motion-only and exists only in GPU Studio.

Other problems:
- iOS asks separately for DeviceMotionEvent and DeviceOrientationEvent, and each needs a user gesture.
- iOS Shake to Undo raises an 'Undo Typing' alert if a text field has undo history.
- Tilt parallax is a vestibular trigger.
- Sensors that quietly keep running drain the battery and feel creepy.

**Solution:**

SENSORHUB. It keeps the existing states (off, requesting, listening, active, denied, unavailable). Subscribers (burst, wobble, tilt window, snow) receive shake(impulse) and tilt(beta, gamma) events, low-passed and throttled to 20 Hz as today. The hub pauses while document.hidden, stops after 2 minutes without a consumed event, and stops on pagehide.

ONE DOOR.
- There are two entry points: a Sensors switch in the Play tray, and an inline offer inside the first sensor toy ('Shake to burst? Turn on motion').
- The tap calls DeviceMotionEvent.requestPermission() synchronously, before any await, as the existing code already requires.
- DeviceOrientationEvent.requestPermission() is requested only the first time a tilt toy is used, so most people see one prompt. iOS's two-prompt behaviour is stated honestly.

THE INDICATOR. While listening, a 'Sensors on' pill with a static dot (no pulse) sits beside the Play chip. One tap switches sensors off and announces it. Sensors are never on at load and never persisted: no storage and no telemetry, per docs/gpu-studio-launch.md.

TWINS. Every sensor verb also has a button and a key.
- Shake: the tray's Shake item (accelerator S). Each tap is one impulse. On iOS it is a direct DOM tap, so a haptic tick is allowed.
- Tilt: a small tilt pad (drag or arrow keys), or simply the camera arrows.
- This satisfies WCAG 2.5.4: sensors are never the only way, and they switch off in one tap.

GUARDS.
- Sensors pause while any text input has focus (Shake to Undo) and resume on blur.
- Burst-class actions need 2 peaks within 400 ms and then a 600 ms refractory period, so walking or a bus ride doesn't burst the molecule. Gentle wobble needs 1 peak.
- The tilt window is capped at plus or minus 3 degrees (C025). It is off under reduced motion and the Gentle and Still comfort levels, just as iOS turns off parallax under Reduce Motion.
- In Low Power Mode (C004's cadence detector) the tilt window defaults to off, because continuous camera motion costs frames; shake stays on.

**Experience:**

Phone: in the tray, flip Sensors, accept one prompt, and a small 'Sensors on' pill appears. Shake the phone and the molecule bursts; tap the pill and sensors are off.

Desktop and switch users press Shake.

VoiceOver: 'Motion sensors on, button, double-tap to turn off'.

Reduced motion: shake gives one still, and tilt is off.

Phone budget: one devicemotion listener at 20 Hz while on, auto-off, and consumers wake the canvas only on impulses.

**Tech:**

- DeviceMotionEvent and DeviceOrientationEvent requestPermission (https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static).
- The snow-motion.ts code, generalised, with an AbortController.
- math@0.1.0 spring2.damp as the tilt low-pass.
- The scheduler 'input' phase writes tilt as a camera offset.
- Shake-to-Undo reference: https://github.com/reyramos/disable-shake-undo

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (the consumers ride R3)

**v9 slice:** SensorHub, the pill and the Shake button, driving GPU Studio's snow, a camera-only tilt window (C025) and the v9 uProgress burst. GpuStudioLaunch.tsx:89 migrates to the hub.

**WebGL2 fallback:** Doesn't depend on the renderer. On old iPhones in Low Power Mode, tilt defaults to off.

**Where in code:**

- packages/ui/src/gpu-studio/snow-motion.ts moves to packages/ui/src/sensors/SensorHub.ts.
- packages/ui/src/gpu-studio/GpuStudioLaunch.tsx:89
- PlayTray.tsx
- packages/ui/src/analytics/events.ts: add only a boolean sensors_enabled event.

**Risks:**

- Tilt toys trigger two iOS prompts.
- Android Chrome grants access without a prompt, so the pill must still appear.
- Some browsers lack these events.
- Auto-off may annoy long shake sessions, so the timer resets on every consumed event.
- The input-focus guard is a heuristic.
- The 2-peak rule adds a little latency to the burst.

**Honesty:** Sensor responses are illustrative display motion through C027. No sensor values are stored or sent, and nothing enters export.

**Judges:**

- E 4/keep: Generalising enablePhoneSnow into one SensorHub that auto-detaches after 2 minutes and on hide is calmer and cheaper, and it ships on v9. It hosts pocket-05's native switch. *Improve:* Adopt pocket-05's <input switch> as the single door control. Verify that transient activation survives the change handler on a device.
- P 3/merge: The same shared sensor flow as the Motion Switch, without the switch-as-haptic trick. Host: R2-pocket-native-play-05. *Improve:* Merge, keeping its auto-off rules and the Shake button stand-in.
- A 2/merge: Host: R2-pocket-native-play-05. It duplicates the Motion Switch, and a native switch is the less intrusive control. *Improve:* Merge. Keep its Shake button and the auto-off rules.
- Pr 3/merge: Merge into R2-pocket-native-play-05. It duplicates the Motion Switch. Generalising the code into a SensorHub is the part worth keeping. *Improve:* Put the SensorHub behind the Motion Switch.
- M 5/keep: Host of P-05. It has one explicit door, a visible 'Sensors on' pill, auto-off on hidden, pagehide and 2 minutes idle, a Shake button for every shake, an iOS Shake-to-Undo guard, a vestibular guard on tilt, and tilt off by default in LPM. *Improve:* Absorb P-05's native switch as the door control, since it gives the permission gesture, role=switch and a haptic in one. Device-test transient activation inside a change handler and how long iOS remembers the grant.

<a id="r2-play-for-everyone-09"></a>
## Flash Guard: a WCAG 2.3.1 safety net in the output pass
`R2-play-for-everyone-09` · foundation · effort M · judges mean **3.2** (E3 P2 A3 Pr3 M5; champion 1, keep 2, rework 2) · self-scored fun 1 / visual 2 · perf costs

> A flash budget on the mood bus stops flashes at the source. A tiny tile-luminance guard at the end of the render pipeline catches what slips through and tells the camera to slow strobing spins. A CI analyzer proves every toy demo safe.

**Framing:** problem->solution

**Builds on:** C035 (spark bloom) + C050 (pulses under 3 Hz) + C033 (bond flicker dropped) + C047 (cosmetic, no flicker) + C021 (the flick's top speed) + C103 (safe clips) + C008 (prewarmed graph swaps)

**Problem:**

Round 1 adds many brightness events: burst sparkle, knife sparks with bloom (C035), highlight pulses (C050), ember glow (C033), hologram flicker (C047), rare-roll flourishes and Remix transitions. Each author promises 'under 3 Hz', but nobody measures them combined. A fast flick of a bright, periodic Cu lattice may also strobe a large area above 3 Hz through aliasing, with no flash authored at all.

WCAG 2.3.1 is Level A: no more than three general or red flashes in any one second, unless the flash area is small. Small means under 0.006 sr, about 25% of a 10 degree field, which WCAG approximates as a 341x256 px rectangle at 1024x768. A general flash is a pair of opposing relative-luminance changes of at least 10%, where the darker state is below 0.80.

**Solution:**

LAYER 1, by construction. Every mood-bus uniform that can change large-area brightness (exposure, bloom strength, emissive pulse, background luminance, transition wipes) carries a flashClass. The bus:
- allows at most 2 opposing transitions of those uniforms per rolling second, leaving margin under 3;
- caps the change per frame;
- makes pulses one-shot, at least 350 ms apart.
It runs on the CPU, works on both backends and costs nothing in shaders.

LAYER 2, the runtime net. A flashGuard stage at the end of the output pass reduces the frame to a coarse tile grid of relative luminance, plus a saturated-red flag (R/(R+G+B) >= 0.8).
- Tiles are sized so one tile is about the WCAG area at the current CSS size: roughly 4x3 on a phone and 6x4 on a laptop, with half-offset overlapping tiles.
- A timestamped per-tile history over the last second counts opposing transitions. It is timestamped because demand frames are irregular.
- When a tile would register its 3rd flash, the guard low-passes that tile, blending with the previous output to keep the change under 10%, until the window clears.
- It also sends a 'strobe' signal to the motion kernel (C003), which lowers the coast's maximum angular speed for this molecule and zoom. This strobe governor fixes aliasing at its source instead of smearing it.

COST CONTROL.
- The full-resolution previous-frame target exists only while the guard is armed: a flash-class source is active, or the tile detector sees fast periodic change.
- Arming swaps between prewarmed graphs at rest, because a pass at zero weight still costs full time (C008).
- The luminance reduction reuses a low-resolution target the pipeline already has, such as the bloom downsample, and otherwise runs a 1/32-scale pass.

LAYER 3, proof.
- The R11 dual lanes render every toy's demo script (the same scripts as 'Show me' in idea 12, frame-stepped with advance()) and run the identical tile algorithm offline. A toy that trips the net fails CI.
- Recorded clips get a PEAT spot check before launch.
- Illustrative share clips (C103) pass through the guard too, since they autoplay on social feeds. Deterministic V2 export does not.

**Experience:**

Nobody sees it working. A photosensitive visitor can burst, slice and flick at full speed without the screen strobing. A very fast lattice spin now reads as a smooth glide rather than flicker.

Reduced motion: the guard has no animation of its own.

Phone budget: a tiny reduction plus CPU counting; the full-resolution history exists only while armed.

**Tech:**

- WebGPU: three r186 TSL in useRenderPipeline (R6), using luminance, a pass() chain and a compute node for the reduction and the counts.
- WebGL2: a fragment reduction into a tiny target, then readRenderTargetPixelsAsync to the CPU, which counts and uploads a clamp-map texture. 1-2 frames of lag is fine, because the rule concerns the 3rd flash within a second.
- The mood-bus flash budget is plain TypeScript.
- References: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html ; PEAT (Trace Center Photosensitive Epilepsy Analysis Tool).

**Backend:** mixed: CPU budget (both); guard [GPU+GL2], with WebGL2 counting on the CPU ([GL2-degraded] latency)

**Rides (v10 requirements):** R6 (pipeline), R7 (CPU counting job), R11 (CI lanes)

**v9 slice:**

Layers 1 and 3 ship on v9 with no GLSL.
- Layer 1: the CPU budget over today's brightness drivers: ScenePostprocessing's Bloom intensity, the ProceduralBackground uniforms and Remix transitions.
- Layer 3: a tools/verify-flash.mjs analyzer over v9 recordings, captured frame by frame through the existing export path.
- Layer 2 waits for R6.

**WebGL2 fallback:** Layer 1 is the same. Layer 2 counts on the CPU from a tiny async readback and uploads a clamp map, adding 1-2 frames of latency. If a tile trips on an old iPhone, the strobe governor alone may be enough; C014 data decides whether to keep the per-pixel blend there.

**Where in code:**

- packages/ui/src/postprocess/ScenePostprocessing.tsx: the v9 budget; later the R6 pipeline module.
- The mood-bus module (C048).
- The C003 motion kernel: the strobe governor's speed cap.
- A new tools/verify-flash.mjs beside tools/verify-asset-quality.mjs.
- tests/ui for the CI lane.

**Risks:**

- False positives would ghost legitimate fast motion, which is why the governor acts first and the clamp second.
- Mapping tiles to degrees assumes a viewing distance. A phone held close covers more of the visual field, so tile sizing is conservative.
- How each node behaves on the WebGL2 backend is unverified.
- This is a safety net, not a certificate; it still needs a manual audit.
- PEAT is old and Windows-only, and Harding-class tools are commercial.

**Honesty:** A safety system; it makes no science claim. It is never part of deterministic export, and illustrative clips are guarded.

**Judges:**

- E 3/rework: Layer 1 (a CPU flash budget on mood-bus uniforms) and Layer 3 (a CI analyzer) are cheap and sufficient, because Lupi authors every flash source. Layer 2 adds a per-frame luminance reduction to the output pass, and on GL2 an async readback every frame with 1-2 frames of latency. That is a permanent cost against a hazard the budget already prevents. *Improve:* Ship Layers 1 and 3 on v9. Make Layer 2 a debug- or CI-only node, not a production pass.
- P 2/rework: Safety matters, but a runtime tile-luminance net in the output pass costs every frame for a problem the toys shouldn't create in the first place. It's process, not play. *Improve:* Ship Layer 1 (the CPU flash budget on the mood bus) and the CI analyzer. Drop Layer 2 unless the analyzer catches a real toy that strobes.
- A 3/keep: Layer 1, a flash budget on the mood bus, is good art-direction discipline. Layer 2 clamps tile luminance at the end of the pipeline, which will ghost legitimate motion and alter the image. *Improve:* Ship layers 1 and 3. Make layer 2 a detector that throttles the offending uniform at its source, never a pixel clamp on the picture.
- Pr 3/keep: Layer 1 (a CPU flash budget on the mood bus) and the CI analyzer are cheap safety and legal insurance. Layer 2's GPU tile guard costs time every frame for rare cases. *Improve:* Ship layers 1 and 3. Park layer 2 until some toy fails the analyzer.
- M 5/champion: Photosensitivity is a safety requirement, and the fun layer adds bloom pulses, sparks, glints, foils, wipes and fast spins of high-contrast patterns. Layer 1 (a flash budget on the mood bus) and layer 3 (a CI analyzer) are cheap, on v9 and cover both backends. *Improve:* Ship layers 1 and 3 first. Keep the runtime tile guard (layer 2) behind the device-lab data, because its per-frame reduction and GL2 readback cost battery on phones. Include the red-flash threshold and a spin-rate cap for strobing.

<a id="r2-play-for-everyone-10"></a>
## Comfort Budget: the camera never moves without you
`R2-play-for-everyone-10` · system · effort S · judges mean **4.0** (E4 P3 A4 Pr4 M5; champion 1, keep 4) · self-scored fun 2 / visual 2 · perf improves

> One comfort policy inside the motion kernel: without input the camera doesn't move, requested glides have hard caps, a rolling vection budget turns excess scripted moves into cuts, parallax is capped at 3 degrees, and a Standard/Gentle/Still setting doesn't wait for the OS flag.

**Framing:** problem->solution

**Builds on:** C023 (rubber band, no squash) + C030 (entrance on atoms, not the camera) + C019/C020 (no camera demos) + C021/C034 (dive cap) + C025 (parallax cap) + C082 (stages, not a continuous zoom) + C113 (fly caps)

**Problem:** Many ideas move the camera without a finger: dream tours (C020), glide-to-atom (C023), the dive (C034), flights (C113), Powers of Ten (C082, the mobile judge's 'vestibular stress test'), tilt parallax (C025) and ghost demos (C019: 'an automated camera flick on arrival is still unrequested motion'). Large-field rotation, zoom and parallax are the classic vestibular triggers (Val Head in A List Apart; WebKit's 'Responsive design for motion'). Today only prefers-reduced-motion exists, and many motion-sensitive people never set it.

**Solution:**

RULE 0, no input, no camera. The camera moves only as the result of the user's own input: a drag, a flick coast, the wheel, keys, or a glide they tapped. C030's first-open entrance moves atoms, not the camera. C020's breathing is light-only. Attract and dream tours are an opt-in desktop kiosk mode.

RULE 1, caps on requested moves (glides, detent snaps, fly-tos, scale stages):
- peak angular speed of at most 120 deg/s;
- zoom rate of at most 1 e-fold per 400 ms, in log distance;
- at most 600 ms long;
- no roll mixed in;
- the FOV never animates (no dolly zoom);
- one dominant axis, using C003's 'glide' easing.
A flick coast is user-driven and exempt from the budget, but it decays on the 'glide' token and carries C021's dive cap.

RULE 2, the vection budget. The kernel sums involuntary camera motion (degrees plus e-folds while no finger holds the camera) over a rolling 60 s. Past a threshold, further scripted moves that minute become 150 ms crossfade cuts. The threshold starts at 360 degrees plus 3 e-folds and is tuned in idea 13. Direct 1:1 manipulation never counts.

RULE 3, parallax. Dome and backdrop parallax and the tilt window are capped at plus or minus 3 degrees, and are off under Gentle and Still.

RULE 4, no screen shake anywhere. Bursts and knives carry their energy in atom offsets, never the camera.

RULE 5, rubber-band limits (C023). They resist and spring back within Rule 1's caps. The scale card ('1.4 nm wide') is text with an aria-live announcement. There is no molecule squash (the art director's cut).

COMFORT SETTING, in the tray footer and in Settings:
- Standard, the default.
- Gentle: coast off, so the molecule stops on release; glides over 90 degrees become cuts; no parallax.
- Still, the default when prefers-reduced-motion is reduce: one still per action (idea 11), cuts only.
Crossfade cuts are limited to one per second, which keeps them inside the flash budget (idea 9).

**Experience:**

Standard feels as lively as before, but nothing moves on its own. A motion-sensitive visitor picks Gentle once, and the molecule stops dead when they let go. With the OS reduce-motion flag set, every glide becomes a soft cut.

Keyboard: the setting is in the tray and in Settings.

Phone budget: shorter scripted motion means fewer frames. A Low Power Mode cadence shortens the coast.

**Tech:**

- math@0.1.0 spring.dampAngle, spring3 and easing inside the C003 kernel.
- A ComfortPolicy measures the change in angle and log distance per frame of scripted motion.
- The prefers-reduced-motion media query.
- The crossfade is a DOM opacity dip over the canvas, with no GPU work.
- References: https://alistapart.com/article/designing-safer-web-animation-for-motion-sensitivity/ , https://webkit.org/blog/7551/responsive-design-for-motion/ , https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for per-job fps)

**v9 slice:** All of it on v9, alongside the C003/C021 camera controller, including rewriting CameraFocus's per-frame lerps as capped springs.

**WebGL2 fallback:** Doesn't depend on the renderer. In Low Power Mode the coast is shortened, because a low frame rate combined with motion is itself uncomfortable.

**Where in code:**

- packages/ui/src/CameraFocus.tsx: the 0.14/0.07 lerps.
- The C003 kernel module.
- packages/ui/src/flythrough.ts: tours respect the budget.
- packages/ui/src/SceneModControls.tsx:131: the backdrop pauses under reduced motion.
- The store's comfort setting.

**Risks:**

- The thresholds are heuristics, not clinical values; present them as comfort defaults.
- Gentle may feel dull, so it stays opt-in unless the OS asks for reduced motion.
- The budget could cut a flight the user wanted. Direct manipulation is always exempt, and flights get an 'I'm fine with motion' override.

**Honesty:** No bearing on the science. Comfort settings never change data or exports.

**Judges:**

- E 4/keep: The comfort policy lives inside the C003 kernel (no camera motion without input, capped glides, a vection budget) and ships on v9 with no renderer cost. Shortening coasts in Low Power Mode is a nice touch. *Improve:* Make every other camera toy obey it, including Juice Pass (cross-13) and Symmetry Snap's tumble (pocket-08).
- P 3/keep: 'The camera never moves without you' matches good game feel: an unrequested camera move feels like losing control. Its caps are also what keep Juice Pass honest. *Improve:* Put it in one table inside the C003 kernel alongside Juice Pass's caps. Gentle mode should keep coasts, just shorter.
- A 4/keep: 'The camera never moves without you' is a motion-design rule I would sign. Caps on scripted angular speed, log-distance zoom rate and roll keep glides elegant. *Improve:* Make it a property of the C003 motion tokens, so every glide inherits the caps. Let sig-13's dolly-outs pass only through the same caps.
- Pr 4/keep: 'The camera never moves without input' is a crisp product rule that protects the specimen brand and vestibular users. It is small and ships on v9. *Improve:* Encode it in the motion kernel with tests, and require Juice Pass and tours to comply.
- M 5/champion: 'The camera never moves without you' is the motion-sickness budget round 1 lacked: caps on requested moves, a vection budget that turns excess into cuts, a 3° parallax cap, a Standard/Gentle/Still setting that doesn't wait for the OS flag, and a shorter coast in LPM. S effort, on v9, inside C003. *Improve:* Make it a lint- and test-enforced kernel policy, have FM-10, P-08 and CP-13 consume it, and put the setting one tap from the Play chip.

<a id="r2-play-for-everyone-11"></a>
## Every Toy Speaks and Stills: the access contract a toy must sign to register
`R2-play-for-everyone-11` · foundation · effort M · judges mean **3.6** (E4 P2 A3 Pr4 M5; champion 1, keep 3, merge 1) · self-scored fun 2 / visual 3 · perf improves

> A typed ToyManifest, enforced by CI, so reduced motion, narration and battery life don't rot as 30 toys arrive. It covers intents for every modality, one designed still per action, a caption, a settle bound, flash and comfort classes, a reset and a real twin.

**Framing:** problem->solution

**Builds on:** C027 (closed-form deformers with CPU twins) + C002 (settle, then sleep) + C003 (tokens) + C001 hooks + the round-1 lesson 'demand frames are a contract' + the existing GPU Studio still-per-press

**Problem:** 'Reduced motion = a new still per action' exists in GPU Studio (runtime.ts:294-302), but nothing makes a new toy honour it, narrate itself, offer a key, declare its flash risk or reset cleanly. With 20-30 toys arriving through D3's lazy toy registry, per-toy discipline will rot, and reduced motion will quietly become 'skip'.

**Solution:**

THE MANIFEST. Registration requires a ToyManifest with these fields:
- id
- intents: {pointer, keyboard, button, sensor?}
- still(action, state) -> PoseKey
- caption(action, state): at most 90 characters, saying 'illustrative' in words
- settle: {token, maxMs}
- flashClass: none, pulse, sparkle or fullframe
- comfortClass: atoms-only, camera or parallax
- reset()
- altActions (idea 7)
- realTwin? (the D5 route)

REDUCED MOTION. Under Still comfort or prefers-reduced-motion, an action produces exactly one designed still: the pose that tells the story. It is evaluated from C027's closed-form deformer at a chosen t* on its CPU twin, then one invalidate(), then one frame. It appears after an opacity crossfade of at most 150 ms and holds until the next action. Designed examples:
- Burst: the hang frame at maximum spread.
- Knife: the halves 0.6 nm apart, with the section visible.
- Pluck: the mode's extreme pose, with the rest pose ghosted at 30%, so one frame reads as before and after.
- Heat: the jitter frozen at that temperature's amplitude, with the value in text.
- Reset: the true pose.

NARRATION. Captions go to one coalesced polite live region, e.g. 'Burst: atoms spread for display, your structure is unchanged. Reset puts them back.'

CI, in the R11 dual lanes. For each registered toy, under page.emulateMedia({reducedMotion: 'reduce'}):
- (a) each keyboard intent produces at most 2 rendered frames, counted by a dev-only render counter;
- (b) a caption is announced;
- (c) reset returns the offset sum to 0;
- (d) export bytes are identical with the toy active (C027's test);
- (e) the flash analyzer (idea 9) passes its demo script;
- (f) a button path exists (idea 7);
- (g) the toy settles within maxMs, and then the frame loop sleeps (C002).
A toy that fails cannot register.

AUTHORING. Authors get a template and a generator, so the contract is a 10-minute fill-in, not a review meeting.

**Experience:**

A reduced-motion visitor bursts caffeine and sees one beautiful still of the exploded view, with a sentence underneath; Reset brings the true molecule back.

A screen-reader user hears every toy's result.

Toy authors ship faster, because the checklist is automated.

Phone budget: the settle contract guarantees the viewer returns to zero idle frames after every toy.

**Tech:**

- TypeScript types and a registry.
- C027's CPU twins, evaluated at t*.
- The scheduler's invalidate() and onIdle.
- Playwright emulateMedia.
- A dev-only render counter in DevProbe.tsx.
- The reset check reads back the offset buffer's sum on v10, or the uProgress value on v9.

**Backend:** DOM/CPU contract; stills render [GPU+GL2]

**Rides (v10 requirements):** R3 (closed-form deformers), R7 (demand/onIdle), R11 (dual CI lanes)

**v9 slice:** The manifest type, the registry and the CI checks for the v9 toys: flick and coast, the uProgress burst and condense, Remix, GPU Studio snow (already a still per press) and the lasso. No GLSL.

**WebGL2 fallback:** Same. The CI lane also runs on the WebGL2 backend, so the stills are checked there too.

**Where in code:**

- New packages/ui/src/play/toyManifest.ts plus a registry.
- packages/ui/src/gpu-studio/runtime.ts:294-302 as the reference behaviour.
- packages/ui/src/DevProbe.tsx: the render counter.
- A new tests/ui/toy-contract.spec.ts.

**Risks:**

- The process may slow toy authors; the generator and template mitigate that.
- Designed stills need art-director time for every toy.
- Caption fatigue, which a 'brief captions' setting addresses.
- The render counter must count real submits on both backends.

**Honesty:** The contract makes 'illustrative' a required caption in words, requires a real-twin link where one exists, and uses CI to verify that the fun layer never changes export bytes.

**Judges:**

- E 4/keep: A typed ToyManifest enforced in CI (still per action, settle bound, flash and comfort classes, reset, real twin) is what keeps demand frames and reduced motion from rotting as toys multiply. It hosts flagship-11. *Improve:* Share one manifest type with port-08's lazy registry. Generate a template so authors don't balk.
- P 2/merge: A typed manifest with stills, captions and settle rules stops 30 toys from rotting, but it duplicates Toy Cartridges' manifest. Host: R2-port-as-toy-engine-08. *Improve:* One manifest type carrying the access fields, plus a generator so toy authors aren't slowed down.
- A 3/keep: Forcing a designed still per toy costs art-director time, and that cost is the point. *Improve:* Add a visual class (overlay, offset or look) to the manifest, and put each toy's still golden on sig-10's contact sheet.
- Pr 4/keep: A contract every toy must sign (a still per action, a caption that says 'illustrative', a settle bound, a reset, a real twin) is how honesty and accessibility survive 30 toys. It hosts flagship-11 and play-07. *Improve:* Share one manifest type with Toy Cartridges, so there is one registry.
- M 5/champion: A registration contract (intents for every modality, a designed still per action, a caption that says 'illustrative', a settle bound, flash and comfort classes, reset, alt actions), checked in CI on both lanes, is how accessibility survives 30 toys. It also makes battery life (settle, then sleep) structural. *Improve:* Unify it with PT-08's cartridge manifest into one ToyManifest. Add a flash-class budget check against PE-09 and a thermal class, and supply a generator so authors don't route around it.

<a id="r2-play-for-everyone-12"></a>
## The Grammar Is the Collection: first-touch surprises and a 'secrets found' meter
`R2-play-for-everyone-12` · system · effort S · judges mean **3.4** (E3 P4 A3 Pr3 M4; keep 3, merge 2) · self-scored fun 4 / visual 2 · perf neutral

> The 14 'secrets' are exactly the gesture grammar. Each is celebrated the first time you stumble on it, counted in a meter in the Play tray, and explained by a hint ladder with 'Show me' and 'Do it for me'. The help page and the collection are the same sheet.

**Framing:** problem->solution

**Builds on:** C019 (reworked as 'Show me') + C094 (a passport stamp for verbs, the playtester's fix) + C041 (captioned plink) + the playtester's 'discovery meter' spark; easter eggs are left to D7

**Problem:** Nothing makes toys findable. The only hint is a text pill that vanishes after the first touch (ViewerGestureHint.tsx). Help pages are panels nobody opens, and hidden gestures reward only the lucky. The playtester asked for a discovery meter; D7 owns easter eggs. What strangers most need to discover is the grammar itself.

**Solution:**

THE ENTRIES (about 14): flick and coast; catch mid-spin; tap to ripple or pluck; double-tap glide; double-tap-hold-slide zoom; stretch past the zoom limit (the scale card); twist and let go (it springs upright); the long-press loupe; opening the tray by long-press or right-click; the verbs (Knife, Lasso, Wake, Tug); Burst; heat, then Release; Shake (by sensor or button); a bond hop with the atom cursor; and Reset.

FINDING. An entry is found when it is performed once by any modality: pointer, key, button, switch or palette. None is privileged, because the found-events are intent-bus listeners (idea 1). The count is kept in localStorage behind try/catch, with no account and no server.

FIRST-TIME FLOURISH. A small DOM toast, 'Found: Catch', on the kernel's snap token, plus one captioned plink. It never blocks, lasts at most 1.5 s and is announced politely.

THE METER. It sits in the tray header ('Secrets found 5/14'). Tapping it, or pressing ?, opens Controls and Secrets, which is the help page:
- Found entries show the exact gesture for touch, mouse/trackpad, keys and button.
- Unfound entries show a hint ladder:
  - Level 1, playful: 'It hates being interrupted mid-spin'.
  - Level 2, concrete: 'Tap while it's spinning'.
  - Level 3: 'Show me' plays the abstract touch-mark demo (idea 14, C019 reworked) once on the live molecule. 'Do it for me' performs the intent and counts as found: accessibility over purity.

NUDGES. At most one per session, and contextual. After 15 s of orbit-only play, the chip breathes once. After the 3rd hard flick, a toast says 'Tip: tap while it spins'. Under reduced motion, both are text only.

COMPLETION. 14/14 unlocks a cosmetic 'Specimen' stamp in C094's passport and a new chip colour. No streaks, no timers, no FOMO.

ANALYTICS (PII-free): grammar_found{id, modality}, once per device. It tells the team which entries nobody finds, and those get redesigned.

**Experience:**

Desktop: flick hard and a small 'Found: Coast, 2/14' slides in; later, the sheet teaches right-click.

Phone: the same with thumbs, and the meter makes people try the tray.

Screen reader: 'Found: Bond hop, 6 of 14.'

Switch: 'Do it for me' works and counts.

Keyboard: ? opens the sheet.

Phone budget: DOM toasts on the compositor; no canvas frames.

**Tech:**

- React DOM.
- localStorage behind try/catch.
- math@0.1.0 spring for the toast.
- Intent listeners from idea 1.
- packages/ui/src/analytics/events.ts gains one new PII-free event.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it for the v9 entries: flick, catch, glide, the zoom-limit card, twist, lasso and the uProgress burst, plus the sheet and the hint ladders. Later entries appear as their verbs ship.

**WebGL2 fallback:** Doesn't depend on the renderer.

**Where in code:**

- New packages/ui/src/play/{secrets.ts, ControlsSheet.tsx}.
- Replaces packages/ui/src/app/ViewerGestureHint.tsx.
- packages/ui/src/analytics/events.ts.
- C094's passport store.

**Risks:**

- Gamifying basic controls can feel patronising to experts. The meter lives only in the tray, and toasts can be switched off.
- Toast clutter: at most one per 10 s.
- Private windows start fresh.
- The entry list must track grammar changes, which is why it is generated from the intent table.

**Honesty:** Every entry is an interaction verb, not a science claim. The toasts never appear in captures or exports.

**Judges:**

- E 3/keep: Making the gesture grammar the collectible is a cheap DOM discoverability loop and hosts flagship-07's hint policy. Gamifying basic controls can feel patronising, and it overlaps joy-12's notebook meter. *Improve:* Render the meter inside joy-12's notebook rather than as a second counter.
- P 4/merge: Celebrating the first double-tap glide or twist-and-release turns the control scheme into discoveries, which is very good for discoverability. Risks: patronising experts and cluttering the screen with toasts. Host: R2-joy-and-mastery-12. *Improve:* Make it the Field Notebook's Verbs page, so there is one collection and one meter, and celebrate with a sound and a stamp rather than toasts.
- A 3/keep: A quiet meter and occasional toasts are acceptable, but this would be a second collection UI. *Improve:* Make the collection sheet a page of joy-12's ink Notebook rather than a separate UI.
- Pr 3/merge: Merge into R2-joy-and-mastery-12. Counting gestures as secrets teaches the controls, but this is one of three separate 'secrets found' meters. *Improve:* Make it the Verbs page of the Notebook.
- M 4/keep: Host for FM-07 and JM-12. Counting a secret found by any modality (pointer, key, button, switch, voice) is equity by design, and the help page and the collection are one sheet. *Improve:* Toasts announce politely once and can be turned off. No entry may depend on speed or dexterity, and 'Do it for me' must count as learning, not cheating.

<a id="r2-play-for-everyone-13"></a>
## Couch Test: stranger playtests, local gesture traces and gesture-conformance CI
`R2-play-for-everyone-13` · system · effort M · judges mean **3.6** (E3 P4 A2 Pr4 M5; keep 5) · self-scored fun 2 / visual 1 · perf neutral

> Every two weeks, five strangers play on couch phones and trackpads, with a screen-reader user and a switch user each quarter. An opt-in local gesture trace records what their fingers did, and CI replays every gesture in the grammar.

**Framing:** problem->solution

**Builds on:** C014 (device lab, delight events) + C019 (scripted demos as smoke tests, the engineer's idea) + idea 1 (intent table) + the round-1 gap 'a stranger playtest protocol'

**Problem:** No stranger has used any of these gestures. The fact sheet has no device data and no delight events. Every threshold is a guess: slop, long-press time, gutters, the vection budget, the two-finger trackpad bet. Mode errors and OS conflicts only show up on real couches.

**Solution:**

(1) PROTOCOL, every 2 weeks during the port, with 5-6 strangers (not developers).
- Devices: an old iPhone on iOS 17/18 (the WebGL2 fallback) in Low Power Mode; an iPhone on iOS 26 (WebGPU); a mid-range Android with gesture navigation; a MacBook trackpad; a Windows mouse. Each quarter, add at least one screen-reader user and one switch or voice-control user, paid, recruited through an accessibility testing panel. One session per round runs with reduced motion on.
- Setting: a couch, one hand, and the only instruction 'This is a molecule; play with it.'
- Tasks: (a) 60 s of silent free play; (b) find three things it can do; (c) make it look like it did at the start; (d) show a friend the coolest thing; (e) look closely at one atom; (f) on a trackpad, zoom in on the ring.
- Debrief: what was fun; anything confusing or queasy; a single ease rating.

(2) GESTURE TRACE. A dev-only ?playtest flag keeps a local ring buffer of arbiter intents: intent, gesture class, target class, durations, cancels, verb, comfort level, screen zone (not coordinates) and gallery id only. Testers can export it as JSON; nothing uploads. Metrics:
- time to first rotate and to first poke;
- mode errors: a verb stroke reset within 2 s, or a verb drag immediately followed by a switch to Orbit;
- OS steals: pointercancel, or a back navigation within 2 s of a drag start;
- stuck moments: 8 s or more touching with no recognised intent;
- loupe opens from ambiguous taps;
- grammar entries found at 5 minutes;
- comfort changes.

(3) GO/NO-GO PER VERB. Ship a verb only if at least 4 of 5 strangers perform it within 5 minutes, unaided or via the meter; there is less than 1 mode error per session; there are no OS steals; and no one reports queasiness in Gentle.

(4) WIZARD OF OZ FIRST. Try each verb on v9 with DOM overlays or uProgress before any shader exists.

(5) CONFORMANCE CI. The idea-1 intent table generates Playwright tests, and each test asserts the emitted intent in both R11 lanes:
- CDP Input.dispatchTouchEvent drives tap, double-tap, a 450 ms hold, pinch, twist, two-finger tap, and an edge-start drag that must be ignored;
- wheel sequences with wheel-like and trackpad-like deltas;
- key sequences per scope;
- axe-core on the tray and the sheet.
A grammar change that breaks a test needs a playtest note.

(6) PRODUCTION ANALYTICS (PII-free): time_to_first_rotate, first_poke, grammar_found, play_reset and sensors_enabled, added deliberately to the ~12-event taxonomy.

**Experience:**

Visitors never see it; the product just keeps getting less confusing. The team gets one JSON trace per session showing exactly where a stranger's thumb fought the grammar.

Phone budget: a fixed-size ring buffer, only behind ?playtest.

**Tech:**

- Playwright plus the CDP Input domain (Chromium) for multi-touch.
- page.emulateMedia and axe-core.
- A small local ring buffer in the arbiter.
- The existing tests/ui/mobile-scene-controls.spec.ts patterns.
- iOS edge gestures and haptics can't be emulated in CI; they are tested only in playtests.

**Backend:** DOM/CPU

**Rides (v10 requirements):** R11 (dual lanes); none for v9

**v9 slice:** All of it now: tests against the v9 arbiter, traces behind ?playtest, and protocol rounds on v9 Wizard-of-Oz prototypes.

**WebGL2 fallback:** The CI suite runs in both lanes, and the device matrix deliberately includes the WebGL2 fallback on an old iPhone in Low Power Mode.

**Where in code:**

- New tests/ui/gesture-grammar.spec.ts.
- packages/ui/src/input/trace.ts.
- packages/ui/src/analytics/events.ts.
- The protocol belongs in docs/. This is a proposal; the brainstorm writes nothing to the repo.

**Risks:**

- Recruiting and paying accessibility testers needs an owner and a budget.
- Samples are small, and lab behaviour differs from a real couch.
- Traces must stay local and coarse to stay PII-free.
- CDP touch isn't iOS WebKit, so CI can't prove the edge and haptic rules.

**Honesty:** Results are reported as observations. No FPS numbers are claimed.

**Judges:**

- E 3/keep: The protocol is sound, and gesture-conformance CI through CDP multi-touch is valuable. It is mostly process, needs a budget owner, and iOS edge gestures can't be emulated. *Improve:* Record traces in the port-12 tape format so playtest sessions become CI fixtures.
- P 4/keep: Not a toy, but the only way any threshold in this list gets tuned: couch phones, Low Power Mode, and a screen-reader and a switch user each quarter. Process that finds fun rather than pretending to be fun. *Improve:* Start now with Wizard-of-Oz v9 prototypes of True Spin, symmetry detents and Pop-It. Use a fixed script, and log the first smile, first poke and abandonment moments.
- A 2/keep: Outside my lens. *Improve:* Add an observation line to the protocol: did the stranger look at the molecule or at the chrome?
- Pr 4/keep: The only qualitative measure of fun anyone proposed, and five strangers every two weeks is cheap. Paid accessibility testers need a budget owner. *Improve:* Name the owner and the budget, and tie findings to telemetry thresholds.
- M 5/keep: Stranger playtests every two weeks, with old iPhones on GL2 in Low Power Mode, and paid screen-reader and switch users every quarter: the only idea that validates my lens with real people and devices. *Improve:* Name an owner and a budget. Add a vestibular-sensitive tester and a low-vision zoom (200-400%) user, and feed findings into PE-01's threshold tokens.

<a id="r2-play-for-everyone-14"></a>
## Touch Marks: the arbiter thinks out loud
`R2-play-for-everyone-14` · toy · effort S · judges mean **3.4** (E3 P4 A4 Pr3 M3; keep 5) · self-scored fun 3 / visual 3 · perf neutral

> A tiny SVG layer shows what the grammar recognised under each finger: a contact ring, a hold ring that fills toward the loupe, a slide caret, a pinch line and each verb's stroke. That makes long-press, double-tap-slide and latched verbs discoverable, and the same layer powers 'Show me' and C019's demo.

**Framing:** problem->solution

**Builds on:** C019 (the abstract touch-mark rework) + C024 (loupe hand-off) + C023 (the slide-zoom affordance) + C035/C040/C029 (verb strokes) + C103 (optional replay overlay)

**Problem:** Law L5 leaves the scene unchanged while a finger is held, so a long-press gives no feedback for 450 ms and people lift too early. That is why round 1 called long-press undiscoverable. Double-tap-hold-slide has no affordance, and a latched verb under the thumb isn't obvious. C019's translucent hand was judged a cliche, and the art director asked for an abstract touch mark instead.

**Solution:**

An SVG overlay above the canvas (pointer-events none), driven by arbiter events through direct DOM writes outside React render. Touch and pen only; the mouse gets cursor changes instead.

THE MARKS.
- Contact: a 28 px ring with a 1.5 px stroke in the brand colour, drawn around the contact rather than over it, so it never hides the atom.
- Hold: the ring's stroke fills clockwise over 450 ms. Moving past the slop resets it. Completion 'clicks' on the snap token and hands off to the loupe bubble (C024) or the tray origin. This one mark makes long-press discoverable and cancellable.
- Double-tap: a second concentric ring. Double-tap-hold shows an up/down caret for slide-zoom.
- Two fingers: a hairline between the contacts with a mid-dot, plus an arc for twist.
- Verb strokes, in the verb colour: Knife draws a crisp cut line that lingers 300 ms, Lasso's path closes into a light fill, and Wake leaves a short comet. These are the strokes themselves; the 3D response happens in the scene.
- Catch: a quick collapsing ring.
- Gutter touches draw nothing, which honestly shows they were ignored.

REUSE.
- The same component renders the 'Show me' demos (idea 12) and C019's first-visit demo, from scripted intent sequences that drive the real controllers.
- Instant Replay (C103, D4) can include the marks from the trace ring buffer, for 'how I did it' clips. Being DOM, the marks never enter deterministic export or plain captures.

SETTINGS. 'Show touches' is on for the first session on touch devices, then subtle (smaller, faster fade), or off.

REDUCED MOTION. No fill animation: a hold shows the text 'Hold...' and then 'Loupe', and there are no lingering trails.

**Experience:**

Phone: put a thumb down and a faint ring appears. Keep holding and it fills, then clicks, and the loupe blooms out of it. Double-tap and hold, and a caret invites the slide. In Knife, a clean line follows the finger and the molecule parts along it. In a tablet demo, the audience can see what the presenter's fingers are doing.

Keyboard users get focus rings instead; the marks are touch-only.

Phone budget: compositor-only transforms and opacity on a few SVG nodes; no WebGL or WebGPU frames.

**Tech:**

- Inline SVG, with CSS transforms and stroke-dashoffset for the hold fill.
- math@0.1.0 spring for the snap.
- Subscribes to arbiter events; no canvas involvement.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it on v9, with the v9 arbiter: contact, hold, double-tap and pinch marks, the lasso stroke, and the 'Show me' demos.

**WebGL2 fallback:** Doesn't depend on the renderer; the same on old iPhones.

**Where in code:**

- New packages/ui/src/input/TouchMarks.tsx, fed by GestureArbiter.
- Mounted in packages/ui/src/ViewerApp.tsx above the canvas.
- Together with idea 12, it replaces packages/ui/src/app/ViewerGestureHint.tsx.

**Risks:**

- Visual clutter, the art director's concern: keep marks small, fast-fading and touch-only.
- It could clash with iOS's own long-press UI; the Edge-Safe callout rules suppress that on the canvas.
- Extra DOM writes during a 120 Hz drag must stay compositor-only; C014 measures the effect.

**Honesty:** UI feedback only, with no science. Marks never appear in exports, and in replays only when the user chooses.

**Judges:**

- E 3/keep: An SVG layer written outside React makes long-press and double-tap-slide discoverable at near-zero cost, and it powers 'Show me'. The risk is clutter. *Improve:* Touch only, fast fade. Share the layer with the hint ladder.
- P 4/keep: A hold ring that fills toward the loupe teaches long-press while you do it: discoverability through feedback, with juice. S effort, on v9. The risk is clutter. *Improve:* Touch only, with fades under 300 ms. Reuse the same marks for the Verb Ladder's 'Show me' demos so there is one visual language.
- A 4/keep: A 28 px ring with a 1.5 px stroke, drawn around the contact rather than over it, fading fast and shown for touch only. It is a restrained mark system that makes the grammar legible without covering the specimen. *Improve:* Host fm-07. Put the mark vocabulary in sig-01's tokens, allow one mark per finger, and draw no trails for the mouse.
- Pr 3/keep: It makes hidden gestures (long-press, double-tap-slide) legible. It risks cluttering a calm specimen. It hosts flagship-07. *Improve:* Touch only, fast fades, and switch each mark off once its verb is learned.
- M 3/keep: Making long-press, double-tap-slide and latched verbs visible helps discovery and cognitive accessibility, but it is touch-only and adds visual noise. *Improve:* Use static states under reduced motion (no fill animation), system colours under forced-colors, and 3:1 contrast against every Look. Merge the 'Show me' demo with PE-12.
