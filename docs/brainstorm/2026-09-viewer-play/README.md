# Lupi viewer: play, speed and visual power with pmndrs math and R3F v10 — two-round brainstorm, 2026-09-27

> **Owner decisions (2026-09-28):** the open questions in section 8 are answered in [decisions.md](decisions.md), which overrides this report where they differ. In short: the R3F v10 port is the priority and goes straight to production; the bar is "it works" (no device perf program or metrics prerequisites); C60 first; home still until touched; audio off by default; arcade-style play is allowed; XR deferred; Export V2 cut at the platform swap; GPU Studio folds into Looks.

**What this is.** You asked how the new pmndrs `math` library and recent React Three Fiber (R3F) releases could make Lupi's viewer and GPU viewer faster, better looking and more fun for a newcomer clicking, dragging and playing on a laptop or phone, through a wide brainstorm, a review, a second brainstorm and a second review. This folder is the result, written on the assumption you added: **Lupi upgrades to R3F v10 alpha**.

Nothing in the Lupi codebase was changed, and no idea has been built or tried on a device. No real-device frame-rate or thermal data exists for any Lupi surface, so this report makes no measured performance claims; the [performance ledger](#34-performance-ledger) grades each expected gain or loss by its evidence. Motion described as decorative is **illustrative**: it never moves source atoms and never enters deterministic export.

**How it was made.** Eight research agents and a completeness critic, then a four-agent v10 study once you chose v10. Nine lens ideators wrote 180 round-1 ideas, merged into 119. Five judges scored them: an engineer on the v10 baseline, a play-tester, an art director, a product steward, and a mobile and accessibility judge. Nine round-2 directions wrote 126 more ideas, which the same judges scored while picking their best of both rounds. Four skeptical fact-checkers tested 36 load-bearing claims. Then this synthesis.

**File map**

| Path | What it holds |
|---|---|
| [research/00-fact-sheet.md](research/00-fact-sheet.md) | Cross-digest facts as of research (pre-fact-check), product rules, corrections, open questions |
| [research/01-v10-baseline-brief.md](research/01-v10-baseline-brief.md) | The R3F v10 baseline: requirements R1–R12, unlocks, losses, re-scoring rules |
| [pmndrs-math](research/pmndrs-math.md), [r3f-releases](research/r3f-releases.md), [pmndrs-ecosystem](research/pmndrs-ecosystem.md), [threejs-webgpu](research/threejs-webgpu.md) | Library and release research |
| [playful-web](research/playful-web.md), [science-toys](research/science-toys.md) | How others build playful 3D and science toys |
| [code-core](research/code-core.md), [code-fun](research/code-fun.md) | Lupi's render path, hotspots, existing toys and product rules |
| [v10-migration](research/v10-migration.md), [v10-unlocks](research/v10-unlocks.md), [v10-status](research/v10-status.md) | The v10 study |
| [research/bench.md](research/bench.md) | Local benchmark scripts behind the `math` numbers, as one markdown file |
| [round1-review.md](round1-review.md) | Round-1 tiers, judge splits, lessons and the round-2 brief |
| [round1-catalog.md](round1-catalog.md) | 180 round-1 ideas as 119 canonical ideas, C001–C119, with scores and critiques |
| [round2/README.md](round2/README.md) and nine direction files | All 126 round-2 ideas, sorted by score, with judge critiques |
| [verification.md](verification.md) | The 36-claim fact-check |
| [decisions.md](decisions.md) | The owner's answers to section 8 (overrides this report) |

`research/`, `round1-review.md` and `round1-catalog.md` predate the fact-check; where they disagree with [verification.md](verification.md) ([section 6](#6-fact-check-what-the-36-claim-verification-changed)), verification.md wins. `scratchpad/…` paths in verification.md and a few research notes point at the research sandbox's working files, which are not committed.

Scores are 1–5 means across the five judges (E engineer, P play-tester, A art director, Pr product steward, M mobile and accessibility). Round-1 ideas are cited by id (C021) and link to their catalog entries; round-2 ideas link to theirs.

---

## TL;DR

- **Feel first, and most of it ships before the port.** Round 1's top ideas were all about the first gesture ([C003](round1-catalog.md#c003) motion kernel, [C021](round1-catalog.md#c021) flick, [C028](round1-catalog.md#c028) poke ripple, each 4.8), and most of the best feel work is CPU and camera code that runs on today's v9 viewer.
- **Performance: the sure wins are on v9, now:** Quiet Idle, one pick per pointerdown, the idle upload and label fixes, and `math` matrices (from code reading and Node benches, not devices). v10 is net-unknown for the atom impostors until the week-3 gate spike, because early-Z is lost on both backends ([ledger](#34-performance-ledger)).
- **pmndrs `math` is maath rebuilt.** `math@0.1.0` (2026-09-11) has no GPU twins and no three.js bridge. It gives Lupi exact analytic springs, seeded random and geometry (hulls, lasso, IK), replacing at least three spring styles and the frame-rate-dependent lerps in `CameraFocus`, the gist engine and the swirl. Pin it exactly.
- **R3F v10 is alpha, with no beta date.** Pin the 2026-09-26 canary (alpha.5's `/legacy` entry fails); the TSL hooks now live in `@react-three/tsl`, and three r187 (due 2026-10-21) is the realistic floor. Phase 0, a gate spike and parity mean **roughly 4–5 months before v10 toys reach production** (an opt-in `/next` build previews them from M2, weeks 4–9).
- **What v10 buys:** demand frames on one scheduler, a "mood" uniform bus (Looks tween instead of snapping), GPU-side display offsets (pokes, bursts and heat with no CPU copies; the gate spike sets their cost), a multi-target render pipeline (GPU picking, glow, ink edges), and glyph labels (via the WebGPURenderer swap, not v10 itself; K25). **It costs** the N8AO look and vanruesc post, troika text, XR (known broken), byte-stable V1 export (it needs a V2 profile), and impostor early-Z on both backends.
- **GPU Studio comes out of its box.** The WebGPU-only 5k-atom snowglobe in a modal becomes a main-viewer Look at M4, on the viewer's one GPU device; porting its 54 WGSL lines to TSL reaches the WebGL2 fallback. Its door is your call ([§3.6](#36-gpu-studio-under-v10)).
- **Round 2 found molecule-native joy.** A small CPU "Object Facts" module (mass, inertia, symmetry, hull) makes flicks coast on real inertia, with a hidden tennis-racket flip, and gives detents on real symmetry axes and dice that land on real hull faces. Separately, the Mode Harp plays precomputed normal modes (an offline bake that still needs a publisher) on v9's existing `uProgress` lerp with zero new shader code, once the K01 TypeScript plumbing lands.
- **Short list:** motion kernel, True Spin flick, Play chip, quiet idle, symmetry detents, the Buckyball Minute, condense arrival, Mode Harp, Instant Replay, link cards, Lupi Daily, Remix codes, contact shading, Ink and Light, and the poke ripple, the only one that waits for the port. Measurement and an access contract are prerequisites for all of them.
- **Two share loops are half-built.** iPhone AR Quick Look is built but never triggered (it needs a hosted `.usdz` behind a real tap), and every link unfurls with the same `og-lupi.png`.
- **Nothing is measured.** There are no delight events; the analytics filter drops keys such as `chip`, the Worker's allowlist drops new event names, and `view_shared` fires on every save. Measure first: telemetry, a v9 baseline on named phones, then a gate spike that passes or fails the port on a poke and a burst.
- **Honesty is structural; the twin rule is a label, not a gate.** Toy motion lives in a display layer that export zeroes, and the Play chip reads "Illustrative · Reset". Pure-play toys (Juice Pass, Pop-It Shell, Music Box, Star-Trail, Crystalscaper, Shadow Alphabet, Foil) ship with that chip and need no scientific counterpart; the judges' kills of two arcade ideas are yours to overrule ([decision 12](#8-decisions-only-the-owner-can-make)). The fact-check removed one false twin: `sand_w_cascade` is a one-frame recreation, not MD.
- **Main risks:** alpha churn, impostor early-Z loss, a second-class WebGL2 fallback larger than the headline ~13%, the Export V2 rewrite, and chrome creep. [Section 8](#8-decisions-only-the-owner-can-make) lists your decisions.

---

## The short list: if we build 15 things

**A newcomer's first 60 seconds, after the v9 slices** (the [Buckyball Minute](round2/first-minute-flagship.md#r2-first-minute-flagship-01) storyboard; motion on `/` and C60 first are your calls):
1. On `/`, a still ink buckyball sits in the hero. Dragging spins it, and it clicks into a hexagon view.
2. A tap, and no black splash: the same drawing swells to full screen and condenses bottom-up into the lit 3D cage in under 600 ms.
3. A flick: it coasts on its real inertia ("C60 glides like a marble"), a tap catches it, and it clicks into a pentagon face-on view with a five-note chord.
4. "Hear it": the cage's real breathing mode plays as a harp string with its wavenumber (a camera-only push-and-boing until the mode bake has a publisher).
5. "Share that": one tap sends a 9:16 clip and a live link; the friend watches the same move in their own 3D view, then gets "Your turn".
6. No source atom moved, and the chip says "Illustrative · Reset".

**How it was ranked:** each judge's "best of both rounds" list, weighted by position; mean scores; and how soon the item reaches visitors. Your brief asked for fun, so two 4.4 play champions (Lupi Daily, Remix Codes) outrank process work, which sits above the table as prerequisites.

**Prerequisites and definition of done (every item; not ranked)**
- **Measure first.** [C014](round1-catalog.md#c014) Device Lab 4.2 + [First-Minute Telemetry](round2/first-minute-flagship.md#r2-first-minute-flagship-12) 3.4 (the product steward's #1) + [Parity Exit by Poke](round2/port-as-toy-engine.md#r2-port-as-toy-engine-09) 4.2. The analytics filter drops keys such as `chip`, `tip` and `molecule_name`, and the Worker's `ANALYTICS_EVENTS` allowlist drops any new event name (`library_searched` already is; K07). The gate spike passes or fails the port on named phone classes ([section 7](#7-suggested-sequencing)).
- **Every toy speaks and stills.** [Every Toy Speaks and Stills](round2/play-for-everyone.md#r2-play-for-everyone-11) 3.6 + [Atom Cursor](round2/play-for-everyone.md#r2-play-for-everyone-05) 3.8. Each toy gets a keyboard and screen-reader route (a cursor that announces "Oxygen 3, bonded to C2 and H7"), a designed still under reduced motion, a caption and a reset, checked by a typed toy manifest in CI.

| Rank | Build | Group | Ships | Effort | Means | On judges' best-of lists |
|---|---|---|---|---|---|---|
| 1 | One Motion Kernel + Comfort Budget | Feel | v9 now | S+S | 4.8 + 4.0 | All five; #1 for E, A, M |
| 2 | Fidget Flick with True Spin | Feel | v9 now | S+S | 4.8 + 4.4 | E, P (#2, #3), A, Pr |
| 3 | Gesture Constitution + Play Chip | Feel | v9 now | M+M | 4.4 + 4.2 | E, P, Pr, M (#2) |
| 4 | Quiet Idle on One Clock | Engine | v9 now | M | 4.2 | E (#2), M (#3) |
| 5 | Symmetry Detents on Object Facts | Toys | v9 now | M+M | 4.4 + 4.2 | P, A, Pr |
| 6 | The Buckyball Minute | First minute | mostly v9 | L | 4.0 | P (#1) |
| 7 | Keyframe Relay arrival | First minute | v9 now | M | 4.2 | E |
| 8 | The Mode Harp | Toys | v9, one mode at a time | M | 4.4 | E, P |
| 9 | Instant Replay on The Shot | Share | v9 (camera replays) | M+L | 4.4 + 4.2 | E, P, Pr |
| 10 | Unfurl Everything + `/m/:id` | Share | v9 now | M+M | 4.0 + 4.2 | Pr (#2, #8) |
| 11 | Lupi Daily + spoiler-free card | Games | v9 now | S+S | 4.4 + 3.8 | P, Pr |
| 12 | Remix Codes + Foil Specimens | Pure joy | v9 now; morph after R3/R6 | M+M | 4.4 + 3.2 | None (P and Pr round-1 champion) |
| 13 | Contact + Specimen Rig | Look | v9 slice now; full after R2/R3 | M+M | 4.4 + 3.4 | E, A (#2, #4) |
| 14 | Poke ripple on the Touch Field | Toys | after the port | M on top of port | 4.8 + 4.2 | E (#3), P, A, Pr |
| 15 | Ink and Light | Look | CPU engine v9; in-viewer after R3/R6 | L | 4.0 | A (#3) |

**Effort** is each idea's own S/M/L/XL tag, summed across components. Ideators were told only that S is a quick win and XL a moonshot, and no judge validated the tags; as an unvalidated guess, S is days, M one to two weeks, L several weeks.

**1. One Motion Kernel.** [C003](round1-catalog.md#c003) 4.8 + [Comfort Budget](round2/play-for-everyone.md#r2-play-for-everyone-10) 4.0. Every flick and glide, once released, settles in the same wall-clock time at 30 Hz (iOS Low Power Mode), ~60 Hz (most phones, ProMotion iPhones included) or 120 Hz (desktops); a drag's follow is stable but not frame-rate-identical (K10). The camera never moves unless you moved it. Exact `math/time` springs publish motion tokens (snap, glide, float, wobble, settle) with a reduced-motion scale every later idea uses.

**2. Fidget Flick with True Spin.** [C021](round1-catalog.md#c021) 4.8 + [True Spin](round2/joy-and-mastery.md#r2-joy-and-mastery-03) 4.4. A flick coasts on the molecule's own mass distribution ("C60 glides like a marble, benzene like a plate"), and a tap catches it; an asymmetric molecule spun about its middle axis flips over, a tennis-racket secret. Camera-only and physically true. **Needs:** Object Facts' inertia, a hand-written fixed-step accumulator (scheduler 0.2.0 has none), and one rigid-motion convention so picking and export stay correct.

**3. Gesture Constitution + Play Chip.** [Gesture Constitution](round2/play-for-everyone.md#r2-play-for-everyone-01) 4.4 (four champion votes) + [Play Chip](round2/play-for-everyone.md#r2-play-for-everyone-03) 4.2. One finger always orbits; two fingers and double-tap are the camera; long-press is precision. A "Play" pill in the thumb zone swaps what one finger does (Wake, Knife, Lasso, Tug) and reads "Illustrative · Reset" while any atom is displaced. Every judge flagged round 1's missing grammar ("Toys nobody can find don't exist"). On v9 the CPU pick runs once per pointerdown, not on every mousemove. **Risk:** retiring OrbitControls touches saved-view camera state.

**4. Quiet Idle on One Clock.** [C002](round1-catalog.md#c002) 4.2. An untouched molecule stops drawing, phones should run cooler (unmeasured until C014), and the first touch renders at once; today five loops render every frame. It ships on v9 with the standalone `@pmndrs/scheduler` 0.2.0. **Rules:** `demand` + `invalidate()` (`onIdle` is deprecated), no numeric priorities (reversed on v10), and sleep only after an analytic settle under half a pixel.

**5. Symmetry Detents on Object Facts.** [Symmetry Detents](round2/joy-and-mastery.md#r2-joy-and-mastery-04) 4.4 + [Detents That Mean Something](round2/first-minute-flagship.md#r2-first-minute-flagship-05) 4.4, on [Object Facts](round2/joy-and-mastery.md#r2-joy-and-mastery-01) 4.2. Coasts settle on real symmetry axes and mirror planes; C60's 5-fold axis "clicks into a pentagon mandala with a five-note chord", and clean landings chain into combos. Object Facts is one proposed CPU module, with golden tests, that feeds about a dozen toys. **Caveats:** caffeine is effectively C1 (use principal axes); `quickhull3` degenerates on exactly planar input such as `graphene_ribbon.xyz`, so check planarity and fall back to `quickhull2` (K13).

**6. The Buckyball Minute.** [The Buckyball Minute](round2/first-minute-flagship.md#r2-first-minute-flagship-01) 4.0, the play-tester's #1: the storyboard above, combining [C015](round1-catalog.md#c015), [C016](round1-catalog.md#c016), [C030](round1-catalog.md#c030), C021, C028/C073, C041 and Instant Replay. It is the only idea that designs the seams between features, and every C60 view lies within ~22.7° of a 5-fold or 3-fold face axis (confirmed), so a 24° capture cone lands every coast on a composed view. **Waits:** the real pluck needs C073's mode bake; a smooth per-atom stagger needs R3 (item 7 stands in). **Your calls:** motion on `/` (recommended: still until touched), and C60 against the reset's "Water first", A/B'd with the caffeine arc [The Vanishing Ring](round2/first-minute-flagship.md#r2-first-minute-flagship-14) (3.6).

**7. Keyframe Relay arrival.** [Keyframe Relay](round2/port-as-toy-engine.md#r2-port-as-toy-engine-02) 4.2. Each molecule condenses from a seeded cloud on first open (under 600 ms, cancelled by any touch); switching scatters and re-condenses, labelled "transition", not "reaction". "The best v9 slice in the set" (engineer): v9's existing `uProgress` lerp interpolates keyframes sampled from the future deformer's TypeScript twin, so there is zero new GLSL and the twin survives the port. **Caveats:** K01's TypeScript plumbing (the playback owner rewrites `uProgress` every frame). Stagger is piecewise across K keyframes (8 segments up to 5k atoms, 4 up to 30k, lockstep above), and the art director warns of velocity kinks; a smooth per-atom stagger needs an extra attribute or R3.

**8. The Mode Harp.** [The Mode Harp](round2/real-twins-science.md#r2-real-twins-science-05) 4.4, with [C073](round1-catalog.md#c073) 4.2. After a few pretend ripples, the chip offers the molecule's real computed vibrations as harp strings, each with its wavenumber, an "×N" exaggeration chip and a tone. "A normal mode is linear, so base + A·sinφ·m is a lerp between base − A·m and base + A·m" (engineer), which moves C073 to v9 on item 7's plumbing. **Waits:** chords need v10; the mode bake needs a named publisher.

**9. Instant Replay on The Shot.** [Instant Replay](round2/capture-share-loops.md#r2-capture-share-loops-03) 4.4 + [The Shot](round2/capture-share-loops.md#r2-capture-share-loops-01) 4.2, absorbing round 1's [C103](round1-catalog.md#c103) Perfect Loop Clips (4.4). After a good flick, detent chain or Remix roll, one tap sends a frame-exact 9:16 clip and a live link; the friend watches the move in their own 3D view, then gets "Your turn". It stores inputs plus a pose snapshot every 0.5 s, which absorbs cross-browser spring drift (K10), not pixels: about 1.5 KB in a `replay=` URL parameter, with no storage. One capture service (fixed-size target, async readback, Mediabunny, then GIF via gifenc, with MediaRecorder as a last resort) replaces eight duplicated plumbings. Camera, detent and Remix replays ship on v9; toy replays need R3. Output is illustrative, never an MCP artifact.

**10. Unfurl Everything + `/m/:id`.** [Unfurl Everything](round2/capture-share-loops.md#r2-capture-share-loops-05) 4.0 + [/m/:id](round2/capture-share-loops.md#r2-capture-share-loops-06) 4.2, absorbing round 1's [C106](round1-catalog.md#c106) Real Share Cards (4.2). A Lupi link in a chat shows that molecule and opens a zero-canvas page with a spinnable SVG, real facts, "Open in 3D" and "Place on your desk": "the cheapest acquisition win on the list" (product steward), with about 100 static pages doubling as SEO landings. The Worker draws cards from saved-view coordinates, since stored thumbnails exist only on views saved since 2026-09-20 and are small (K03).

**11. Lupi Daily + spoiler-free card.** [C088](round1-catalog.md#c088) 4.4 (P 5, Pr 5) + [The Daily, shared without spoilers](round2/capture-share-loops.md#r2-capture-share-loops-10) 3.8. Everyone gets the same mystery silhouette each day; each wrong guess reveals more until it blooms into colour with its name, and the share is an ink-silhouette card on date-keyed URLs that never name the answer. "The only strong come-back-tomorrow loop" (play-tester); size S and zero-canvas on v9, with the in-viewer reveal on R3/R4/R8. **Caveats:** a text route for screen-reader users, and a 60-day queue (decision 8).

**12. Remix Codes + Foil Specimens.** [C062](round1-catalog.md#c062) 4.4 (P 5, Pr 5) + [Foil Specimens](round2/joy-and-mastery.md#r2-joy-and-mastery-11) 3.2. Every Remix gets a short versioned code that reproduces the look on any device, and phones shake to roll; about one roll in 24 comes up Foil (Holo, Gold leaf or Pearl), cosmetic, at published odds and also earnable by a feat. "A slot-machine loop that ships on v9" (play-tester); the ~600 ms morph waits for the mood bus (R3/R6). **Caveats (K09):** a seed alone doesn't reproduce a Remix, since pre-roll state, flags, atom-count class and catalogs also count; encode the resolved look or a versioned catalog id, and hash that for foil. There is no seed today, and the product steward voted to park Foil.

**13. Contact + Specimen Rig.** [Contact](round2/signature-and-moonshots.md#r2-signature-and-moonshots-03) 4.4 + [Specimen Rig](round2/signature-and-moonshots.md#r2-signature-and-moonshots-02) 3.4 (the art director's #2). Grounded molecules on every device: baked per-atom directional occlusion (no shimmer), a floor shadow drawn from the atom buffer, and one softbox key light across every Look. Phones get AO back without the screen-space passes the mobile rule forbids, and it replaces the N8AO look the port loses. **v9 slice:** scalar baked occlusion on mobile (no GLSL), Neutral tone mapping from the installed `postprocessing`, and the softbox instead of drei HDR presets.

**14. Poke ripple on the Touch Field.** [C028](round1-catalog.md#c028) 4.8 + [Touch Field](round2/port-as-toy-engine.md#r2-port-as-toy-engine-03) 4.2 + [C027](round1-catalog.md#c027) 4.2. Tap an atom and a crisp ~400 ms ripple runs through the molecule and settles; the same field later hosts wake, burst, heat, knife, tug and pluck. Every toy is a slot in one closed-form TSL function ("no new material, no compile, and the same behaviour on both backends"), zeroed by export, with CPU twins for the picker, labels and bonds. **Ships** after R3/R4; the v9 stand-in is [Poke Torque](round2/first-minute-flagship.md#r2-first-minute-flagship-06) (3.4), a camera-only push-and-boing.

**15. Ink and Light.** [Ink and Light](round2/signature-and-moonshots.md#r2-signature-and-moonshots-06) 4.0. One crisp "Illustrate" ink drawing on previews, link cards, the Daily silhouette and stickers; tapping an ink tile lights it into the 3D molecule. "The signature" (art director). Its pure-TypeScript SVG renderer is also the no-GPU fallback and item 10's card engine; the in-viewer Look needs R3/R6.

**Just below the cut:**
- [Place It on Your Desk](round2/capture-share-loops.md#r2-capture-share-loops-08) (4.0; [C110](round1-catalog.md#c110) 4.2 with Pr 5 and M 5): the strongest phone wow, and Quick Look is half-built.
- [C072](round1-catalog.md#c072) Honest Thermometer (4.4, size S, v9).
- [C025](round1-catalog.md#c025) Cursor Lean (3.6) and [C044](round1-catalog.md#c044) Light Painter (3.8): the desktop counterparts of items 1–3, for visitors who only move the mouse.
- [Section View](round2/real-twins-science.md#r2-real-twins-science-06) (4.2), [Loupe 2.0](round2/pocket-native-play.md#r2-pocket-native-play-02) (4.0), [Four Looks, Many Goldens](round2/signature-and-moonshots.md#r2-signature-and-moonshots-10) (4.0) and [C009](round1-catalog.md#c009) Hover for Free (4.2, after the port).
- [Stop-Motion Pocket](round2/pocket-native-play.md#r2-pocket-native-play-10) (3.8) and [Juice Pass](round2/cross-pollination-scout.md#r2-cross-pollination-scout-13) (3.2; the play-tester's champion).

---

## 1. The full range of ideas

The wide menu, by what the visitor gets: mean score, then where it ships ("v9" is today's viewer, "port" is after the v10 rewrite).

**Feel and motion**
- [C003](round1-catalog.md#c003) One Motion Kernel · 4.8 · v9 and [C021](round1-catalog.md#c021) Fidget Flick · 4.8 · v9: same settle at every frame rate; spin, coast, catch.
- [True Spin](round2/joy-and-mastery.md#r2-joy-and-mastery-03) · 4.4 · v9: coasts on real inertia; the tennis-racket flip is a secret.
- [Comfort Budget](round2/play-for-everyone.md#r2-play-for-everyone-10) · 4.0 · v9: no camera motion without input; Standard/Gentle/Still.
- [Juice Pass](round2/cross-pollination-scout.md#r2-cross-pollination-scout-13) · 3.2 · v9: hit-stop, wind-ups and a camera shake capped at 0.5° on desktop and 0.3° on phones (it conflicts with Comfort Budget, per the engineer and product steward).

**Desktop mouse (no click needed)**
- [C025](round1-catalog.md#c025) Cursor Lean · 3.6 · v9: the molecule turns a few degrees toward the cursor; on a phone, one Tilt tap makes the screen a window.
- [C044](round1-catalog.md#c044) Light Painter · 3.8 · v9: drag the sun, and highlights glide on a spring; on v10 it rides the mood bus.
- [C019](round1-catalog.md#c019) Ghost Hand · 3.8 · v9: a translucent hand flicks the real molecule, replacing the text pill.
- [C009](round1-catalog.md#c009) Hover for Free · 4.2 · port: magnet glow under the cursor.

**First minute and landing**
- [C030](round1-catalog.md#c030) Dandelion Burst and Condensation Entrance · 4.6 · v9 via `uProgress`: the house motif.
- [C016](round1-catalog.md#c016) No Dead Splash · 4.4 · v9: prefetch; the tile becomes the molecule.
- [C015](round1-catalog.md#c015) Pocket Molecules on Home · 4.2 · v9: a spinnable SVG on `/` (owner call).
- [The Buckyball Minute](round2/first-minute-flagship.md#r2-first-minute-flagship-01) · 4.0 / [The Vanishing Ring](round2/first-minute-flagship.md#r2-first-minute-flagship-14) · 3.6: spin-first on C60, or search-first on caffeine ("your coffee is flat").
- [Relay Baton](round2/first-minute-flagship.md#r2-first-minute-flagship-03) · 3.8 · v9: the spin carries through the load.
- [The Stills Minute](round2/first-minute-flagship.md#r2-first-minute-flagship-11) · 3.6 · v9: designed stills and a contact-sheet share under reduced motion.

**Touch toys**
- [C028](round1-catalog.md#c028) Jelly Molecule poke ripple · 4.8 · port; v9 stand-in [Poke Torque](round2/first-minute-flagship.md#r2-first-minute-flagship-06) · 3.4.
- [Touch Field](round2/port-as-toy-engine.md#r2-port-as-toy-engine-03) · 4.2 · port: every verb is a uniform slot.
- [Section View](round2/real-twins-science.md#r2-real-twins-science-06) · 4.2 · v9 readouts: a knife that snaps to real lattice planes and shows benzene is flat.
- [Loupe 2.0](round2/pocket-native-play.md#r2-pocket-native-play-02) · 4.0 · v9: hold, slide, release to select.
- [C031](round1-catalog.md#c031) Tug, Taffy and Chain Puppet · 3.6 · port: FABRIK chains with visible strain.
- [C067](round1-catalog.md#c067) Touch the Scan Cloud · 3.6 (P 4) · today's WebGPU-only `/scan` engine: plough and shake the particles of your photo.
- [Pop-It Shell](round2/cross-pollination-scout.md#r2-cross-pollination-scout-02) · 3.0 · port: press atoms through a sheet (play-tester 5, product 1).

**Pure joy (no lesson required).** The twin rule is a label, not a gate: these ship with the Illustrative chip and need no scientific counterpart.
- [Symmetry Detents](round2/joy-and-mastery.md#r2-joy-and-mastery-04) · 4.4 · v9: mandala clicks and combos.
- [C062](round1-catalog.md#c062) Remix Codes that Morph · 4.4 · v9, with [Foil Specimens](round2/joy-and-mastery.md#r2-joy-and-mastery-11) · 3.2: rare cosmetic finishes at published odds.
- [Molecule Music Box](round2/joy-and-mastery.md#r2-joy-and-mastery-05) / [Music Box Molecule](round2/cross-pollination-scout.md#r2-cross-pollination-scout-01) · 3.8 each · v9: spin it and it plays itself.
- [The Handling Loop](round2/joy-and-mastery.md#r2-joy-and-mastery-02) · 3.4 (P 5, the play-tester's champion) · v9: the retention arc from a first secret in 20 seconds to a first foil in a week.
- [Field Notebook](round2/joy-and-mastery.md#r2-joy-and-mastery-12) · 3.6 + [The Secret Pack](round2/joy-and-mastery.md#r2-joy-and-mastery-13) · 3.4 · v9: thirty secrets, ink stamps, a "secrets found" meter.
- [Every Molecule Is a Die](round2/joy-and-mastery.md#r2-joy-and-mastery-06) · 3.4 · v9: tumbles over its real hull.
- [Shadow Alphabet](round2/joy-and-mastery.md#r2-joy-and-mastery-07) · 3.2 · v9: letters hidden in shadows (pilot the yield first).

**Phone-native play**
- [Thumb Arc](round2/pocket-native-play.md#r2-pocket-native-play-01) · 3.8 + [C026](round1-catalog.md#c026) The Molecule Rides the Sheet · 4.0 · v9: every verb within thumb reach, and no canvas resize.
- [Stop-Motion Pocket](round2/pocket-native-play.md#r2-pocket-native-play-10) · 3.8 · v9: held poses on 30 Hz-capped phones.
- [Weightless](round2/cross-pollination-scout.md#r2-cross-pollination-scout-03) · 3.6 / [Plumb Line](round2/pocket-native-play.md#r2-pocket-native-play-06) · 3.0 · v9: hang it from an atom.
- [Sideways Is a Camera](round2/pocket-native-play.md#r2-pocket-native-play-09) · 3.4 (P 4) · v9: turn the phone and the chrome becomes a viewfinder with Look chips and a shutter.
- [Flipper Spin](round2/pocket-native-play.md#r2-pocket-native-play-04) · 3.4 · v9: DOM flippers that can buzz on iOS.
- [The Motion Switch](round2/pocket-native-play.md#r2-pocket-native-play-05) / [One Sensor Door](round2/play-for-everyone.md#r2-play-for-everyone-08) · 3.4 each · v9: one opt-in for sensors, with button stand-ins.

**Sound and haptics**
- [C041](round1-catalog.md#c041) Plink, Whoosh, Tick · 3.8 · v9: one captioned cue grammar.
- [Cue Sheet on the Beat](round2/first-minute-flagship.md#r2-first-minute-flagship-08) · 3.8 · v9: sounds at the spring's analytic times; audio unlocked by a toy.
- [Specimen Sound Kit](round2/joy-and-mastery.md#r2-joy-and-mastery-09) · 3.6 · v9: cues from the object; silent in Inspect, quiet in Play.
- [Haptic Moments](round2/pocket-native-play.md#r2-pocket-native-play-03) · 3.2 · v9: tap-shaped iOS moments.

**Looks and signature style**
- [Contact](round2/signature-and-moonshots.md#r2-signature-and-moonshots-03) · 4.4 + [Specimen Rig](round2/signature-and-moonshots.md#r2-signature-and-moonshots-02) · 3.4; [Ink and Light](round2/signature-and-moonshots.md#r2-signature-and-moonshots-06) · 4.0 with [C049](round1-catalog.md#c049) Illustrate · 4.0.
- [Four Looks, Many Goldens](round2/signature-and-moonshots.md#r2-signature-and-moonshots-10) · 4.0 (Specimen, Illustrate, Night and Clear, guarded by perceptual goldens) and [Designed States](round2/signature-and-moonshots.md#r2-signature-and-moonshots-08) · 4.0.
- [C056](round1-catalog.md#c056) Billiard Balls · 4.0 (M 5) · port: glossy pool-ball atoms whose element symbols fade in as you zoom.
- [C060](round1-catalog.md#c060) Photo Mode · 4.0 (A 5) · port: tap-to-focus, a tilt-shift miniature and a progressive shutter.
- [Bond Grammar](round2/signature-and-moonshots.md#r2-signature-and-moonshots-04) · 3.8 · v9: inferred bonds drawn lighter; keep PubChem's bond orders.
- [Clear](round2/signature-and-moonshots.md#r2-signature-and-moonshots-09) · 3.6 · v9: a colour-blind-safe Look.
- [Specimen Tokens](round2/signature-and-moonshots.md#r2-signature-and-moonshots-01) · 3.6 and [Condense: the logo in motion](round2/signature-and-moonshots.md#r2-signature-and-moonshots-07) · 3.6.
- [C048](round1-catalog.md#c048) Look Pad · 4.4 and [C050](round1-catalog.md#c050) Highlight glow · 4.2 · port.

**Science with a real twin**
- [C072](round1-catalog.md#c072) Honest Thermometer · 4.4 · v9: drag through copper's real melting point.
- [The Mode Harp](round2/real-twins-science.md#r2-real-twins-science-05) · 4.4 · v9, with [C073](round1-catalog.md#c073) · 4.2.
- [Charge, Release, Then Melt It for Real](round2/real-twins-science.md#r2-real-twins-science-03) · 3.8.
- [Evidence Ladder and Twin Door](round2/real-twins-science.md#r2-real-twins-science-01) · 3.6 + [Science Shelf](round2/real-twins-science.md#r2-real-twins-science-02) · 3.2: evidence rungs in words (Pretend to Measured) and a named publisher for baked data.
- [Twelve Prompts, Twelve Toys](round2/real-twins-science.md#r2-real-twins-science-07) · 3.6 · 9 of 12 on v9.
- [Carbon Shape Proofs](round2/real-twins-science.md#r2-real-twins-science-09) / [Roll a Nanotube](round2/cross-pollination-scout.md#r2-cross-pollination-scout-04) · 3.6 each.
- [Scratch Deck](round2/cross-pollination-scout.md#r2-cross-pollination-scout-12) · 3.6 · v9: DJ a real MD run.
- [Burst to a Real Cascade](round2/real-twins-science.md#r2-real-twins-science-04) · 2.8: needs a new copper cascade bake.

**Games and challenges**
- [C088](round1-catalog.md#c088) Lupi Daily · 4.4 · v9, shared as [a spoiler-free card](round2/capture-share-loops.md#r2-capture-share-loops-10) · 3.8.
- [C078](round1-catalog.md#c078) Grow a Crystal · 3.8: seeded, and it ends on the real crystal.
- [Hide an Atom](round2/pocket-native-play.md#r2-pocket-native-play-07) · 3.6 · v9: pass-and-play along the bonds.
- [C091](round1-catalog.md#c091) Find the Atom · 3.4 · v9.
- [Symmetry Snap](round2/pocket-native-play.md#r2-pocket-native-play-08) · 3.2 · v9: a tabletop buzzer duel (it auto-tumbles, so it needs a pause).

**Share and social loops**
- [Instant Replay](round2/capture-share-loops.md#r2-capture-share-loops-03) · 4.4 on [The Shot](round2/capture-share-loops.md#r2-capture-share-loops-01) · 4.2; [/m/:id](round2/capture-share-loops.md#r2-capture-share-loops-06) · 4.2 + [Unfurl Everything](round2/capture-share-loops.md#r2-capture-share-loops-05) · 4.0 · v9.
- [Make It Mine](round2/capture-share-loops.md#r2-capture-share-loops-02) · 4.0 · v9: prepare first, send on the tap, with designed templates and generated alt text.
- [Place It on Your Desk](round2/capture-share-loops.md#r2-capture-share-loops-08) · 4.0 with [C110](round1-catalog.md#c110) · 4.2 · v9: baked AR at a locked 1 Å = 1 cm.
- [C105](round1-catalog.md#c105) Sticker Press · 3.8: one tap makes a die-cut sticker that pastes into chats.
- [The Receiving End](round2/capture-share-loops.md#r2-capture-share-loops-13) · 3.8: arrive inside the moment you were sent.
- [Specimen Camera](round2/capture-share-loops.md#r2-capture-share-loops-09) · 3.6 and [Star-Trail Shutter](round2/cross-pollination-scout.md#r2-cross-pollination-scout-06) · 3.6.
- [Tap-to-Wake Embeds](round2/capture-share-loops.md#r2-capture-share-loops-11) · 3.4 and [Pass the Molecule](round2/capture-share-loops.md#r2-capture-share-loops-04) · 3.0.

**Moonshots** (GPU Studio's [C042](round1-catalog.md#c042) Pocket Worlds is in [§3.6](#36-gpu-studio-under-v10))
- [Six Sides](round2/signature-and-moonshots.md#r2-signature-and-moonshots-13) · 3.6: from water to a snowflake, with [C082](round1-catalog.md#c082) · 3.6 as discrete stages.
- [Crystalscaper](round2/cross-pollination-scout.md#r2-cross-pollination-scout-11) · 3.4: Townscaper for nanocrystals.
- [Made-Of](round2/signature-and-moonshots.md#r2-signature-and-moonshots-14) · 3.2 · mostly on today's WebGPU-only `/scan` engine (touch forces are new shader work, K08): scan particles peel into their molecules.
- [Deep Dive](round2/port-as-toy-engine.md#r2-port-as-toy-engine-10) · 3.0: pinch down to one atom.
- [Crystal Sand](round2/signature-and-moonshots.md#r2-signature-and-moonshots-11) · 2.8 and [Chladni Dust](round2/cross-pollination-scout.md#r2-cross-pollination-scout-14) · 2.8: WebGPU compute showpieces.

**Engine, performance and safety** (most of round 2's "port as a toy engine" direction)
- [Parity Exit by Poke](round2/port-as-toy-engine.md#r2-port-as-toy-engine-09) · 4.2 (the phone gate spike), [C014](round1-catalog.md#c014) Device Lab · 4.2 and [C002](round1-catalog.md#c002) Quiet Idle · 4.2 · v9.
- [Warm Start](round2/port-as-toy-engine.md#r2-port-as-toy-engine-06) · 3.8 (the first poke never compiles) and [C004](round1-catalog.md#c004) Measured Quality Ladder · 3.8.
- [Joy Ladder](round2/port-as-toy-engine.md#r2-port-as-toy-engine-01) · 3.6: the port re-cut into milestones that each end in a toy ([section 7](#7-suggested-sequencing)).
- [Toy Cartridges](round2/port-as-toy-engine.md#r2-port-as-toy-engine-08) · 3.6 (lazy toys with byte budgets) and [Replay Tape](round2/port-as-toy-engine.md#r2-port-as-toy-engine-12) · 3.6 (one event-and-pose log for CI, replays, demos and bug reports).
- [Zero-Byte Play](round2/port-as-toy-engine.md#r2-port-as-toy-engine-05) · 3.2 (a 16-byte atom; toys cost no per-atom bytes), [Phoenix](round2/port-as-toy-engine.md#r2-port-as-toy-engine-07) · 3.2 (device-loss recovery), [Flash Guard](round2/play-for-everyone.md#r2-play-for-everyone-09) · 3.2, [Engine Spine](round2/port-as-toy-engine.md#r2-port-as-toy-engine-11) · 3.0 (where `math` and the scheduler live) and [Twin Velocity](round2/port-as-toy-engine.md#r2-port-as-toy-engine-04) · 2.6 (exact impostor motion vectors, parked).

### Capability → problems it solves

| Capability (status) | Problems it solves | Ideas |
|---|---|---|
| Analytic springs (`math/time`) | Frame-rate-dependent feel; cues off the beat | C003, C021, Comfort Budget, Cue Sheet |
| Seeded RNG (`mulberry32`) | Nothing random is reproducible or shareable | C062 (encode the resolved look, K09), Daily, Replay Tape, Foil odds |
| Curl/simplex noise (CPU) | Idle breathing, camera shake, loop clips | Juice Pass, C020; per-atom noise needs TSL `mx_noise` |
| quickhull, polygon2 | Hulls, rest faces, lasso, cell counts | Object Facts, the die, Carbon Shape Proofs, C040 |
| FABRIK | Tug a chain with no force field | C031 (use `solve`/`iterate`) |
| Scheduler + demand frames (0.2.0, v9) | Always-on rendering; five loops; export order | C002, Stop-Motion Pocket, Toy Cartridges |
| TSL storage buffers (tsl canary) | Offsets and particles with no CPU copy | Crystal Sand, C067, Chladni Dust (fewer on WebGL2) |
| `useUniforms` mood bus | Looks snap; recompiles | C048, C044, Specimen Rig, Touch Field slots |
| Render pipeline + MRT | Lost N8AO; no selective bloom or ID buffer | C009, C050, Illustrate edges, half-res SSAO |
| `@pmndrs/glyph` | troika breaks on WebGPU | [Etched Type](round2/signature-and-moonshots.md#r2-signature-and-moonshots-05) (3.4), shattering labels |
| `@pmndrs/upscaler` | Fill rate on big screens | WebGPU-only tier; fallback gets `fsr1`, no speed-up |
| Async render-target readback | Capture, picking, fallback self-checks | The Shot, C009, Warm Start |
| Per-pointer multi-touch state (v10) | Two-finger and couch play collide | Symmetry Snap, Hide an Atom, the Gesture Constitution's two-finger law |
| DOM drag-and-drop onto meshes (v10) | Gallery and chips can't touch the molecule | Drag a gallery tile or element chip onto it |
| `onOccluded` / `onVisible` (v10) | Offscreen embeds and toys burn battery | Pause them; Tap-to-Wake Embeds |
| Multi-canvas (v10, WebGPU only) | No live thumbnails | Thumbnails inside the viewer, never on `/` |

### Problem → solution

| Problem | Evidence today | Solution |
|---|---|---|
| Nothing to touch on `/` | Zero-canvas home by design | SVG hero, still until touched (C015, item 6) |
| A black splash replaces what you tapped | `main.tsx` splash while ~1 MB loads | Prefetch (C016) + [Relay Baton](round2/first-minute-flagship.md#r2-first-minute-flagship-03) + Keyframe Relay (item 7) |
| Flicks feel generic and vary by device | OrbitControls; `CameraFocus` lerps | C003 + C021 + True Spin + Symmetry Detents (items 1, 2, 5) |
| Desktop visitors who only move the mouse get nothing | No hover response | C025 Cursor Lean + C044 Light Painter now; C009 hover after the port |
| Gestures collide; toys hidden | GPU Studio in a modal; `?billion-atoms` hidden; `MobileHUD` unused | Gesture Constitution + Play Chip + [Touch Marks](round2/play-for-everyone.md#r2-play-for-everyone-14) + [The Grammar Is the Collection](round2/play-for-everyone.md#r2-play-for-everyone-12); [§3.6](#36-gpu-studio-under-v10) |
| Fingers miss small atoms | CPU ray-march picker | Loupe 2.0 now; C009's finger patch later |
| Idle viewer burns battery | `frameloop='always'`; five loops | Quiet Idle (item 4); Stop-Motion Pocket; [ledger](#34-performance-ledger) |
| Looks and Remix snap | Instant store patch | Look Pad on the mood bus (C048); Remix codes that encode the resolved look (C062, K09; item 12) |
| Phones look flat | Mobile post rule: no AO, Bloom or DOF | Contact + Specimen Rig (item 13) |
| Toys could teach wrong science | `sand_w_cascade` was a false twin (K06) | Evidence Ladder + Science Shelf; a real twin for science toys |
| Nothing brings anyone back | No daily, collection or shareable code | Lupi Daily, Remix codes, the Handling Loop |
| Every link looks the same | One `og-lupi.png`; a 7-URL sitemap | Unfurl Everything + `/m/:id` + Ink and Light (item 10) |
| Sharing is a 5 s landscape recording | 1080p MediaRecorder export | The Shot + Instant Replay + Make It Mine (item 9) |
| iPhone AR unreachable | Quick Look built; nothing sets the flag | Place It on Your Desk with a hosted `.usdz` |
| Keyboard and screen-reader users can't play | 2 screen-reader mentions in 180 round-1 ideas | Atom Cursor, [Scoped Keys](round2/play-for-everyone.md#r2-play-for-everyone-04), [Edge-Safe Canvas](round2/play-for-everyone.md#r2-play-for-everyone-02), the access contract |
| We can't tell if anyone smiled | No delight events; dropped keys and events (K07) | Telemetry, [Loop Ledger](round2/capture-share-loops.md#r2-capture-share-loops-14), [Couch Test](round2/play-for-everyone.md#r2-play-for-everyone-13), device lab |

---

## 2. What we found (research)

### 2.1 pmndrs "math": what it is

**Identity.** npm `math` is maath rebuilt in the same repository ([pmndrs-math.md](research/pmndrs-math.md)): emptied on 2026-08-03, re-seeded from Isaac Mason's gl-matrix-style `mathcat` plus new code, and renamed on 2026-08-17. `math@0.1.0` reached npm on 2026-09-11 ([releases](https://github.com/pmndrs/math/releases)); since then there have been only canaries. `maath@0.10.8` is not deprecated, and drei and `@react-three/postprocessing` still depend on it. Lupi imports neither directly.

**API style.** Plain-array tuples, `fn(out, ...inputs): out` with no allocation, and serialisable caller-owned state (springs, PRNGs, noise tables); ESM-only, zero dependencies, and the whole core is 14.4 KB gzipped under Rollup.

| Module | What it has | What it unlocks in Lupi | Gotchas |
|---|---|---|---|
| core | vec, quat, quat2, mat (NO and ZO projections), spherical | Allocation-free transforms, orbit maths, ZO matrices for WebGPU and vgpu | No eigen solver (principal axes need Jacobi), no reversed-Z helper, no quaternion spring |
| `math/time` | `spring`–`spring4`, `damp`, `dampAngle`, `fromResponse`, easings | Frame-rate-independent feel for camera, UI and particles; stable at any `dt` | No back, elastic or bounce easing; no "settled" helper; coefficients aren't exported, so TSL and CSS mirrors copy the formula |
| `math/random` | mulberry32, isaac; float, int, choice, unit vectors, uniform quat | Seeds make tours, gist clouds and the Daily reproducible; a shareable Remix must encode the resolved look (or a versioned catalog id), not just a seed (K09) | `inCircle`/`inSphere` are canary-only (one-liners at 0.1.0); no Fibonacci or Poisson |
| `math/noise` | perlin, simplex 2D–4D, worley, fbm, domain warp, curl | Camera shake, idle breathing, seamless loop clips | CPU only; curl3 ≈ 8k evaluations per 4 ms (indicative Node) |
| `math/shapes` | box, OBB, plane, polygon2, frustum, `raycast3` (triangle, box) | Lasso, X-ray boxes, knife planes, cell counters | No ray-sphere or ray-plane test |
| `math/geometry` | quickhull3/2, triangulation, decomposition | Hull wrap, die rest faces, crystal habits | Allocates; degenerates on exactly flat input (K13) |
| `math/color` | linear sRGB, Display-P3, HSL, CSS parsing | Linear-light highlight blends, P3 palettes | No OKLab/OKLCH |
| `math/ik` | FABRIK 2D/3D with ball and hinge joints | Tug a chain, chain puppet | Forward-only following ignores hinge limits |

**Indicative Node micro-benchmarks** (one container, not a device; [pmndrs-math.md §4](research/pmndrs-math.md), [research/bench.md](research/bench.md)): 10k TRS matrices into `Float32Array` views took about 180 µs, against 245 µs for three's `compose` and 859–1018 µs for the Object3D-dummy pattern. 100k springs took about 3.8 ms, against about 12 ms for maath. Frustum culling was roughly at parity with three.

**Version gates.** Pin `0.1.0` exactly: old `1.0.0-canary-*` versions sort above it. The documented `math/three` bridge is an open, unreviewed PR ([#50](https://github.com/pmndrs/math/pull/50)). Mixing plain and typed arrays in one function was about 5× slower. Anything through `sin`/`exp` is not bit-identical across browsers.

**Where it replaces hand-rolled code in Lupi**

| Today | File | `math` replacement |
|---|---|---|
| Euler–Cromer spring with a 1/30 clamp, new object per step | `packages/ui/src/lib/spring.ts:45-60`; `hooks/usePressSpring.ts:63-80`; `action-light/motion.ts` | `spring.update` |
| Per-frame lerps 0.14/0.07, two `clone()`s per frame | `packages/ui/src/CameraFocus.tsx:46-59` | `spring3` into scratch |
| `EASE = 0.06` / `0.08` per frame | `scan/gist/gistEngine.ts:77,367-370`; `scan/swirl.ts:20,65-66` | `spring.damp` |
| Hand-rolled lookAt and perspective, three `Float32Array`s per call | `scan/gist/gistEngine.ts:223-262` | `mat4.lookAt`, `perspectiveZO` into scratch |
| Object3D dummy + `setMatrixAt` | `GhostAtoms.tsx:44-54`; `gpu-studio/runtime.ts:262-270`; `scene/AtomsTransmission.tsx:193` | `mat4` into subarray views |
| Unseeded `Math.random` | `sceneRemix.ts`; `panels/FlythroughPanel.tsx:253-282`; `gistEngine.ts:154-211` | `mulberry32` + URL seed (Remix: encode the resolved look, K09) |
| `sin`-hash "seeded" backdrops | `ProceduralBackground.tsx:26-32` | `mulberry32` |
| Allocating per-frame culling | `scene/BillionAtomBlock.tsx:294-346` | `frustum` + preallocation |
| `Vector3` per 0.5 Å step on every mousemove | `scene/AtomPicker.tsx` | Hand-written ray-sphere + `raycast3.intersectsBox3`; GPU picking after the port |

### 2.2 React Three Fiber: free wins in 9.7–9.8.1, v10 alpha, and status

**Stable 9.x.** 9.8.1 is `latest` (2026-09-24); Lupi's lockfile has 9.6.1 ([r3f-releases.md](research/r3f-releases.md); [releases](https://github.com/pmndrs/react-three-fiber/releases)). 9.7.0 added react-dom event priorities, which `@react-three/postprocessing` ≥3.0.5 and `@pmndrs/glyph` require (Lupi resolves two postprocessing copies); 9.8.0, synchronous root setup for async WebGPU renderers; 9.8.1, full `<Activity>` support, renderer disposal on unmount, and rerenders that no longer reset `dpr`/`frameloop`.

**Do the bump now; v9 is production until M7** (about 4–5 months). Round 1 folded it into the port ([C001](round1-catalog.md#c001)), but it is Phase 0's first step anyway: fiber 9.8.1, drei 10.7.9 and one copy of `@react-three/postprocessing`. drei 10.7.9's unused `PerformanceMonitor` and `AdaptiveDpr` are the v9 path for [C004](round1-catalog.md#c004)'s measured quality ladder.

**v10 alpha adds** ([CHANGELOG-ALPHA](https://raw.githubusercontent.com/pmndrs/react-three-fiber/v10/CHANGELOG-ALPHA.md)):
- `<Canvas renderer>`: WebGPURenderer with three's WebGL2 backend as fallback.
- One scheduler with phases, `before`/`after` and per-job `fps`.
- Multi-canvas on one renderer; WebGPU only, since on WebGL2 a secondary canvas draws into the primary ([#3965](https://github.com/pmndrs/react-three-fiber/issues/3965)).
- `onFramed`, `onOccluded`, `onVisible`; per-pointer multi-touch state, `interactivePriority`, and DOM drag-and-drop onto meshes.
- Fixed-size output; `Environment`, `useTexture` and `useRenderTarget` in core.
- TSL hooks: `useUniforms` (a shared registry, the "mood bus"), `useNodes`, `useBuffers`/`useGPUStorage` for compute, and `useRenderPipeline` with MRT (renamed from `usePostProcessing` in alpha.3).

**Status on 2026-09-27** ([v10-status.md](research/v10-status.md)):
- **Releases.** alpha.5 (2026-09-08) is the newest alpha; there is no alpha.6 or beta, and the milestone is 87% done with no due date.
- **Pin the canary.** alpha.5's `/legacy` entry fails ([#3921](https://github.com/pmndrs/react-three-fiber/issues/3921)); canary `10.0.0-canary.14007b4` (2026-09-26) fixes it.
- **The TSL hooks moved** to `@react-three/tsl` (canary only). Its `latest` tag is a stale first canary, so pin the same hash as fiber; the canary satisfies its peer range with no override (K19).
- **Version pins.** React below 19.3. three ≥0.185, with r187 the floor for the WebGL2 leak fix ([three #34597](https://github.com/mrdoob/three.js/issues/34597)). drei 11.0.0-alpha.7 has one real test; its `Text` exists only on `/legacy`, and `Outlines` and `PointMaterial` are broken on WebGPU.
- **Open issues that bite:** [#3926](https://github.com/pmndrs/react-three-fiber/issues/3926) renderer leak on unmount; [#3958](https://github.com/pmndrs/react-three-fiber/issues/3958) stale DPR; [#3931](https://github.com/pmndrs/react-three-fiber/pull/3931) priorities reversed; [#3864](https://github.com/pmndrs/react-three-fiber/issues/3864) pipeline pass-ownership RFC.

### 2.3 The rest of pmndrs, and three r185/r186

| Package or release | What's new | Fits Lupi? |
|---|---|---|
| three r184 (Lupi's pin) / r185 | `WebGLNodesHandler`, `ReadbackBuffer` / `storageTexture3D`, `ClusteredLighting`, WebXR on WebGPU | Installed / v10's floor |
| three r186 (0.186.1) | `GaussianSplat` (WebGPU only), OIT, `SSAONode`, VXGI, `SunLight` + cascaded shadows; `PCFSoftShadowMap` removed; `positionGeometry` replaces `positionLocal` in `positionNode`; normalized single-component u8/u16 attributes unsupported on WebGPU | The port's baseline |
| three r187 (due 2026-10-21) | Fixes the WebGL2-fallback program leak; PMREMs become cube targets | Shipping floor |
| drei 10.7.9 / 11.0.0-alpha.7 | Patch on v9 (`PerformanceMonitor`, `AdaptiveDpr`, `PresentationControls` unused today) / `/legacy` + `/webgpu`, 27 of 144 components with WebGPU files | 10.7.9 now; 11 is required by v10, so verify each component at runtime |
| `@react-three/postprocessing` 3.1.3, vanruesc `postprocessing` 6.39.5 | `DepthPicking`, `EffectGroup`; AGX and Neutral already in Lupi's 6.38.3 | WebGL only: use Neutral now, lose it at the port |
| `@pmndrs/scheduler` 0.2.0 | One loop, phases, per-job fps, demand stepping | **Yes, on v9 today**; no fixed timestep; `onIdle` deprecated |
| `@pmndrs/glyph` 0.1.0 | MSDF/Slug text, break-apart glyphs | At the renderer swap (R8) |
| `@pmndrs/upscaler` 0.2.0 / `@pmndrs/sky` 0.3.0 / `denoiser` v2 | FSR1 + temporal upscaling / physical sky / OIDN denoising | WebGPU-only tier / v10 only, folded into Light Painter ([C044](round1-catalog.md#c044)) / unpublished |
| `@pmndrs/pointer-events`, `@react-three/handle`, `@react-three/timeline`, `koota`, react-spring v11 beta; `@pmndrs/detect-gpu` 6 | Grab-without-orbit, choreography, ECS, `usePresence`; GPU tiers frozen since Dec 2025 | Optional, v10 runtime unverified; measure tiers instead |
| `@react-three/rapier`, uikit, r3f-perf | — | rapier and r3f-perf are incompatible with v10; uikit is likely WebGL-only (`onBeforeCompile`; an inference) |
| `@react-three/xr` 6.6.30 | No v10 line | Known broken under v10 (`XRFrame` dropped) |
| vgpu 0.5.0 | Breaks the texture API | Stay on 0.4.0 |
| `pmndrs/react-three-examples` | 268 R3F v10 WebGPU ports | Templates ([§2.5](#25-who-is-already-building-on-v10-tsl-and-math)) |

**WebGPU reach.** Safari 26 turned WebGPU on by default (2025-09-15) across iOS, iPadOS, visionOS and macOS 26; Chrome and Edge support it on desktop, and Chrome on Android 12+ with Qualcomm or ARM GPUs (K30). The headline is about 87% support, but the real WebGL2 fallback share is larger than 13%: Lockdown Mode, blocklisted GPUs, Android drivers and Safari 26 on older macOS all fall back, so gate on a non-null `requestAdapter()`. On the fallback, compute runs through transform feedback, with no atomics or storage textures, and `ShaderMaterial`, `onBeforeCompile` and vanruesc post run on neither backend ([threejs-webgpu.md](research/threejs-webgpu.md)).

### 2.4 How others build playful 3D

From [playful-web.md](research/playful-web.md) and [science-toys.md](research/science-toys.md):

- **An immediate physical answer to touch** (spring, overshoot, sound, tick): [pmndrs/math's own examples](https://github.com/pmndrs/math/tree/main/examples/src) (spring tail, XPBD circles, flow field, snake); [Schroeder's Interactive MD](https://physics.weber.edu/schroeder/md/); [PhET](https://phet.colorado.edu/en/simulations/build-a-molecule).
- **GPU toys touch the CPU with "a few uniform writes".** Lit GPU tubes drive a click shockwave through one shared uniform timer ([Codrops](https://tympanus.net/codrops/2026/09/07/drawing-with-light-an-exploration-of-lit-gpu-tubes-with-tsl-and-webgpu/)): the model for the Touch Field.
- **Surprise is cheap on a solid base.** [Unseen's cellular toy](https://unseen.co/labs/cellular/) is plain rigid bodies plus post-processing.
- **Cap everything that piles up.** Garden Anomaly caps audio at 8 voices ([Codrops](https://tympanus.net/codrops/2026/08/06/garden-anomaly-a-tiny-webgpu-and-tsl-experiment/)).
- **Presets per device, and simulation on the GPU.** Bruno Simon's folio drops blur, depth of field and shadow resolution on mobile ([case study](https://www.awwwards.com/brunos-portfolio-case-study.html)); see [Maxime Heckel's TSL field guide](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/).
- **Render on demand, and expect iOS throttling.** Low Power Mode caps rAF at 30 Hz ([WebKit 168837](https://bugs.webkit.org/show_bug.cgi?id=168837)), and cross-origin iframes stay throttled until tapped inside.
- **Emergence, remix and rituals:** [Particle Life on WebGPU](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html); [Sandspiel](https://maxbittker.com/making-sandspiel/)'s gallery; [Chemicle](https://wesleyjding.github.io/chemicle/)'s daily molecule.
- **A signature look worth posting:** Goodsell's pastels with outlines ([Illustrate](https://github.com/ccsb-scripps/Illustrate); [Mol* illustrative](https://molstar.org/viewer-docs/tips/illustrative-style/)); [speck](https://wwwtyro.github.io/speck/)'s AO-heavy atoms.
- **Physical presence and sound:** Quick Look banners on your desk ([variant3d](https://www.variant3d.com/blog/using-banners-in-quicklooks)); [Still Night](https://stillnight.joshua-garcia.com); [molecular sonification](https://arxiv.org/abs/2601.02652).

**What makes play feel good:** (1) one clear verb with an instant, springy answer; (2) a reason to continue: a collection, a secret, a daily; (3) something worth showing a friend; (4) a consistent look; (5) restraint in voices, particles, flashes and camera motion; (6) for Lupi, **honesty**, as in GPU Studio's "Display-only inertia. Source atoms never move."

### 2.5 Who is already building on v10, TSL and math

[`pmndrs/react-three-examples`](https://github.com/pmndrs/react-three-examples) ports 268 three.js WebGPU examples to R3F v10 ([v10-unlocks.md §7](research/v10-unlocks.md) ranks 20). These map straight onto ideas here:

| Template | What it shows | Lupi use |
|---|---|---|
| [interactive-cubes-gpu](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/interactive-cubes-gpu.tsx) | 1×1 integer-ID pick pass, async readback, one in flight | C009 hover and picking up to 5M atoms |
| [postprocessing-bloom-selective](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-bloom-selective.tsx) | Per-object `mrtNode` bloom mask | C050 highlight glow |
| [backdrop](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/backdrop) | `backdropNode` + `viewportSharedTexture()` | Loupe 2.0's lens on v10 |
| [postprocessing-ao](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-ao) | Prepass normals, GTAO/SSAO | Contact; the N8AO replacement |
| [compute-particles](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-particles) | `useBuffers` state, pointer → impulse kernel, 200k sprites | Gist particles in the main canvas; poke and burst |
| [compute-geometry](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/compute/compute-geometry.tsx) | `geometryNode` auto-dispatch, Verlet spring-back "jelly" | C028 Jelly Molecule |
| [multiple-canvas](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/scene/multiple-canvas.tsx) | 40 canvases on one device | Live thumbnails inside the viewer (WebGPU only) |
| [postprocessing-transition](https://github.com/pmndrs/react-three-examples/tree/main/src/examples/postprocessing/postprocessing-transition.tsx) | Two scenes and a `transition()` wipe | Molecule-switch dissolve |

**Real apps and starters.** [krispya/threejs-conf-talk](https://github.com/krispya/threejs-conf-talk), a `math` co-maintainer's Threejs Conf 2026 talk (commits to 2026-09-24), runs the `math` canary with fiber 10.0.0-alpha.5, koota 0.6.6, glyph 0.1.0 and three ~0.186; its `math` use is light (easings, `clamp`/`lerp`, and `mulberry32` for deterministic motion). [R3F-Workshop/v10-starter](https://github.com/R3F-Workshop/v10-starter) pitches the mood-bus pattern: shared `useUniforms`, with Leva changes that avoid recompiles. The Codrops pieces in §2.4 are TSL-on-WebGPU builds too.

### 2.6 Lupi today, seen as a toy

`/` is a search box, 48 static SVG thumbnails, 12 lesson cards and a drop zone, with no motion and zero canvases (a Playwright test enforces it). A click brings up a pulsing black "Lupi" splash while about 1 MB of viewer downloads. The molecule then arrives dead still, with a pose, palette and light different from the tapped thumbnail; the only teaching is a text pill. Phones get the same, reflowed: rotate, pinch and tap-to-inspect, with no flick, double-tap, long-press or sensor play outside GPU Studio. A mouse that only moves gets no response ([code-fun.md](research/code-fun.md)). The [problem → solution table](#problem--solution) pairs each gap with its evidence and fix.

---

## 3. Assuming v10: the upgrade as a toy engine

### 3.1 The cost

Engineer-weeks for one engineer who knows the code ([01-v10-baseline-brief.md](research/01-v10-baseline-brief.md); [v10-migration.md §9](research/v10-migration.md)):
- **Phase 0 on v9, about 2 weeks:** v9-safe pins (React ~19.2.4, three 0.186.1, fiber 9.8.1, drei 10.7.9; remove r3f-perf, the stale `apps/web` rpp 2.x and zustand 4), renderer-agnostic shims, the R2 repack and the ExportManager state machine.
- **Gate spike, 1 week:** port only the atom impostor to a sandbox route and measure early-Z, the iOS <26 fallback and buffer limits on phones.
- **Parity, 13–20 weeks.**

| # | Requirement | Size | Risk | Opportunity it opens |
|---|---|---|---|---|
| R1 | Pins; drop rpp, postprocessing, n8ao, r3f-perf (Phase 0 takes only the v9-safe pins; the canary triplet and post removal land at the platform swap) | ~2 d | Low | Drops drei 9 / zustand 4 |
| R2 | Atom attribute repack | ~2 d | Blocker | A free per-atom flag byte |
| R3 | Atom impostor TSL port (515 GLSL lines) | 2.5–3.5 wk | High | Display offsets, glow MRT, sphere normals, velocity |
| R4 | Bond TSL port | 1–1.5 wk | Medium | Bonds follow offsets |
| R5 | Six smaller materials | 1.5–2 wk | Low–med | Sky on the mood bus; OIT filter shell |
| R6 | Post → one `useRenderPipeline` | 1.5–2 wk | Medium | Selective bloom, outline, wipes, half-res SSAO, `fsr1` |
| R7 | Scheduler phases | 0.5–1 wk | High if skipped | Demand frames, one loop |
| R8 | Label shim over glyph | 1–2 wk | Medium | Labels that shatter |
| R9 | Export V2 | 2–3 wk | High | Fixed-size output for share cards |
| R10 | XR decision | 0.5–4 wk | Highest | — |
| R11 | Dual CI lanes | 1–1.5 wk | Medium | Every toy's fallback smoke test |
| R12 | Renderer swap | in platform swap | Low | One `GPUDevice` for viewer, gist, bonds, Studio |

**Fact-check corrections to the cost:** R2's free byte needs `prop` cut to 8 bits, and only normalized attributes error (K22); R3 loses early-Z on both backends, including `forceWebGL` (K23); R7's hook order flips to 100 → 2 → 1 → 0 → −0.5 (K21). Details are in [section 6](#6-fact-check-what-the-36-claim-verification-changed).

### 3.2 What becomes cheap

The brief ranks, by payoff × reach: demand frames with per-job fps; the mood uniform bus; GPU-resident display offsets for poke, jiggle, burst and melt at 100k+ atoms (degraded on WebGL2); render pipeline + MRT for glow, outline, wipes and ink; phone-grade post (a candidate until device data exists); GPU ID picking; gist particles in the main canvas (with a new pointer force, K08); visibility and multi-touch events; fixed-size output; shattering labels. WebGPU-only extras need stated fallbacks.

### 3.3 What gets harder or is lost

The N8AO look, vanruesc post and troika `Text` go, and presets need re-tuning. Immersive XR is deferred, with USDZ Quick Look as the iPhone path. Export keeps `specId`, but the fingerprint, `artifactKey` and digests change, and AGENTS.md's "V1 truth" needs a rewrite. Impostor and fallback performance risks are in the [ledger](#34-performance-ledger); the fallback also fails silently. The hooks moved packages 18 days after alpha.5, and rapier and r3f-perf are incompatible (uikit is likely WebGL-only).

### 3.4 Performance ledger

No row is device-measured; the evidence column says how much weight each can bear.

| Change | Faster or slower | When | Evidence | Idea |
|---|---|---|---|---|
| Idle viewer stops drawing; five rAF loops become one demand loop | Faster: less battery and heat at rest | v9 now | Code reading; idle cost unmeasured | Quiet Idle (#4) |
| One CPU pick per pointerdown, not an allocating ray-march on every mousemove | Faster pointer handling | v9 now | Code reading | Gesture Constitution (#3) |
| `BillionAtomBlock` stops uploading 4 textures per still frame; labels stop re-rendering ~20×/s at idle | Faster idle | v9 now | Code reading | C005 → C014 idle budgets |
| `math` matrices into `Float32Array` views; allocation-free springs; preallocated culling | ~180 µs vs 859–1018 µs per 10k matrices; 100k springs ~3.8 ms vs ~12 ms (maath) | v9 now | Node bench (indicative) + code reading | `GhostAtoms`, GPU Studio, `AtomsTransmission`; C003 |
| drei `PerformanceMonitor` / `AdaptiveDpr` instead of static UA-tier DPR | Holds frame rate by trading DPR | v9 now | Unmeasured | C004 |
| GPU-resident display offsets | No CPU copies for pokes and bursts | v10 (R3) | Unmeasured; the gate spike sets the cost | Touch Field |
| GPU ID picking | Hover and picks up to 5M atoms | v10 (R3/R6) | Unmeasured; a template exists (§2.5) | C009 |
| Early-Z lost for atom impostors on both backends | Slower; size unknown | v10 (R3) | Code reading of three r186 (K23) | Gate spike; C013 contingency |
| WebGL2 fallback leaks GL programs | Slower over a session | v10 before r187 | Upstream fix ([#34597](https://github.com/mrdoob/three.js/issues/34597)) | Ship on r187+ |
| Slow material init; a first poke that compiles | Slower first interaction | v10 | Brief (unmeasured) | Warm Start |
| HalfFloat output and MRT attachments on tile GPUs | Possibly slower on phones | v10 | Inference | Mobile post rule; gate spike |
| More visitors on the WebGL2 fallback than the headline ~13% | Degraded tier for them | v10 | K30 | Gate on `requestAdapter()` |
| Gating on the reported vertex-storage limit | Needless fallback on Safari 26.2–26.5, which reports `undefined` | v10 (R12, gist) | K31 | Request a literal limit |

### 3.5 How the product rules change

GPU Studio can become a Look ([§3.6](#36-gpu-studio-under-v10)). Idle becomes `demand` by default. "Source atoms never move" becomes structural: the base buffer uploads once and play writes only offsets, so more motion means more labelling. Deterministic export excludes the fun layer; cards and clips are illustrative, never MCP artifacts. Home stays zero-canvas. The mobile post rule holds until device data exists, and XR is frozen until decided.

### 3.6 GPU Studio under v10

- **Today.** Lupi's most polished toy is a snowglobe behind a header modal ("GPU" on phones), four steps deep: WebGPU-only on its own device and rAF, capped at 5,000 atoms with no bonds, refusing the WebGL2 fallback. Its interior shader is 54 lines of WGSL through vgpu, pinned at 0.4.0 because 0.5.0 breaks the texture API ([code-fun.md](research/code-fun.md); [v10-migration.md §7](research/v10-migration.md)).
- **What the port does.** R12 puts Studio on the viewer's one `GPUDevice` (vgpu's `initFromDevice`). M4 makes it a Look in the main canvas, removing the second device, the separate rAF and the paused-frameloop dance. Porting the 54 WGSL lines to TSL `Fn` lets the Look reach the WebGL2 fallback; otherwise it stays WebGPU-only and degrades to the non-Studio look.
- **What becomes possible:** the snow-globe shake as a main-viewer toy (M4's "toy you can feel"); [C042](round1-catalog.md#c042) Pocket Worlds · 3.6, whose fold the judges liked but whose marble, lava-lamp and galaxy siblings they called scope creep; Crystal Sand and Chladni Dust, the WebGPU compute showpieces, behind the same door; and a higher atom cap once the gate spike has device data (C042's "tens of thousands" is an inference).
- **Your call** ([decision 14](#8-decisions-only-the-owner-can-make)): keep Studio as a separate door, or dissolve it into Looks plus the Play chip.

---

## 4. Round 1: brainstorm and review

**Lenses and numbers.** Nine lenses (first 30 seconds, mobile-native, math sweep, R3F sweep, perf and feel, looks, playful science, social and creator, games) wrote 20 ideas each: 180 ideas, merged into 119. **19 champions, 30 strong, 25 folded, 17 rework, 22 parked, 6 killed** ([round1-review.md](round1-review.md)).

**Champions (19).** C003 Motion Kernel, C021 Fidget Flick and C028 Jelly Molecule at 4.8 (E/P/A/Pr/M 5/4/5/5/5, 5/5/4/5/5 and 5/5/4/5/5); C030 Dandelion Burst and Condensation 4.6 (5/5/5/4/4); C016 No Dead Splash, C062 Remix Codes, C072 Honest Thermometer, C088 Lupi Daily, C103 Perfect Loop Clips and C048 Look Space at 4.4; C002 Quiet Idle, C014 Device Lab, C015 Pocket Molecules on Home, C110 On My Desk, C106 Real Share Cards, C027 Deform Stack, C009 GPU ID Picking and C073 Pluck a Molecule at 4.2; C001 Lupi on v10 at 4.0.

**Sharpest splits.**
- **Invisible foundations:** C002 and C014 (E/Pr/M 5, P/A 3) are the base everything depends on.
- **Brand moment vs comfort:** C082 Powers of Ten (A 5, E/Pr/M 3), with precision and vestibular risk.
- **Fake transformation:** C118 Molecule Reel (P 5, Pr 3): arcing atoms imply a transformation that doesn't happen.
- **Unverified pipeline:** C069 Made-Of (P/A/Pr 4, E/M 2), the heart of `/scan` on unverified pieces.
- **Also split:** C046 Depth Atmosphere, C045 Film Stocks and C066 Matcap Bake (loved by A or M, invisible to P at 2); C070 Atomize Me (off-mission, Pr 2); C047 Hologram (erases element colour, A 1).

**Killed, and why.** C018 Living Wall (1.4): live canvases on `/`. C059 Electron Fuzz (1.8): "decoration posing as evidence". C086 Lab-in-a-Tab (1.8): research execution on a ~29 MB GPL wasm. [C099](round1-catalog.md#c099) Periodic Pinball (2.0) and [C102](round1-catalog.md#c102) Nanokart (1.8): arcade skins with no molecule, and Nanokart was the worst motion-sickness risk; these two kills narrow your "not just hard science" brief ([decision 12](#8-decisions-only-the-owner-can-make)). C100 Shake the Jar (2.0): it teaches a wrong self-assembly mechanism.

**Cross-cutting lessons.** (1) **One Play layer:** closed-form deformers `f(base, t, uniforms)` with CPU twins that the picker, labels and bonds share, zeroed by export, with `t−dt` giving velocity. (2) **The mood bus has costs:** `select()` evaluates both branches, zero-weight passes cost full time, and tone-mapping changes rebuild the output node. (3) **Motion tokens are the feel system,** and Condense is the house motif. (4) **Every illustrative toy has a real counterpart one tap away;** this report treats that as a label, not a gate. (5) Degrade ladders are designed, and every toy declares a settle condition and a still. (6) One capture service; the ID buffer is a query engine. (7) Ship v9 slices first, never as throwaway GLSL.

**Gaps that drove round 2.** Nobody owned the gesture grammar. Toys weren't discoverable, and play wasn't accessible. Nothing was measured. Engineering hazards were skipped: prewarm, device loss, memory, bundle budget. Looks sprawled to about 20, with no house style. The games had no chemistry, so the round-2 brief asked for "no new standalone arcade games" and for joy "from the molecule as an object and from play itself".

---

## 5. Round 2: brainstorm and review

### 5.1 The nine directions

Nine directions wrote 12–15 ideas each. Best in each: [first minute](round2/first-minute-flagship.md), Detents That Mean Something 4.4; [gesture grammar and play for everyone](round2/play-for-everyone.md), Gesture Constitution 4.4; [the port as a toy engine](round2/port-as-toy-engine.md), Parity Exit by Poke, Keyframe Relay and Touch Field at 4.2; [capture and share](round2/capture-share-loops.md), Instant Replay 4.4; [real twins](round2/real-twins-science.md), The Mode Harp 4.4; [pocket play](round2/pocket-native-play.md), Loupe 2.0 4.0; [joy and mastery](round2/joy-and-mastery.md), True Spin and Symmetry Detents 4.4; [signature look and moonshots](round2/signature-and-moonshots.md), Contact 4.4 (best moonshot Six Sides 3.6); and the [cross-pollination scout](round2/cross-pollination-scout.md), Music Box Molecule 3.8, where Juice Pass (3.2) split the play-tester's 5 from the product steward's 2. [Section 1](#1-the-full-range-of-ideas) links every idea.

### 5.2 What improved, in the judges' words (summarised)

All five judges said round 2 is clearly better from their lens. The engineer saw "physically real, renderer-agnostic toys" that "cost no GPU and ship now"; the play-tester, "joy that only a real 3D object can give" where round 1 had "mostly generic shader toys … plus arcade skins". The art director said it "wrote the missing style", and the product steward that it "filled round 1's structural gaps". Mobile and accessibility went from "2 screen-reader mentions in 180 ideas" to a whole accessibility direction, plus 30 Hz-cap detection (Low Power, thermal or iframe; K36) and device-loss recovery.

**Where round 2 is weaker.**
- **Its ceiling is lower.** Its top mean is 4.4 (round 1's was 4.8), because many ideas are systems under round-1 champions; 24 of 126 scored ≥4.0, against 25 of 119.
- **Duplication and process.** Replay appears 4×, True Spin 3×, condense 3×, and about 30 ideas are contracts and CI specs.
- **Stock tropes crept back in:** a Liquid Glass loupe, a Dynamic Island clone ([Status Island](round2/cross-pollination-scout.md#r2-cross-pollination-scout-09)), holo glare on `/`.
- **Three ideas drew a kill vote:** [Pop-It Shell](round2/cross-pollination-scout.md#r2-cross-pollination-scout-02) (popped graphene "looks like a buckled or defected sheet"); [Gallery Print](round2/signature-and-moonshots.md#r2-signature-and-moonshots-12) ("XL for a desktop-only poster"); [Worn Bright](round2/cross-pollination-scout.md#r2-cross-pollination-scout-10) (patina "could be read as reactive sites").

### 5.3 Remaining gaps (judges' lists, deduplicated)

- **A chrome budget** for a 390 px phone (four judges; decision 6), and **duplicates merged into single hosts** before planning (all five).
- **One owner for shared bits:** a per-atom byte and flag-bit table; one `uProgress` and offset owner with guaranteed export restore; a render-pipeline budget under RFC #3864.
- **One arrival and Condense spec**, an atom state ladder, one diagram-overlay style and a designed hero for million-atom scenes (art director).
- **Measure before building** (four judges): a v9 device baseline, a one-week Wizard-of-Oz fun test, a North Star with kill criteria (drafted in [section 7](#7-suggested-sequencing)), thermal soak data, and real VoiceOver and TalkBack testing.
- **Accessibility follow-through:** one rate-limited `aria-live` announcer; WCAG 2.2.2 pause controls and a global "Still" switch that also stops sound; 200–400% zoom; forced colours selecting Clear; a simple mode.
- **Also open:** visual stand-ins for sound on muted phones, one universal reset, fun for big scenes, content owners, a teacher channel, localisation, an SEO plan, and the deferred Export V2, XR and bundle-budget calls.

---

## 6. Fact-check: what the 36-claim verification changed

Of 36 claims, 10 were confirmed and 26 hold only with qualifications. None was fully refuted, but parts of several were wrong: K04's atom ceiling, K06's `sand_w_cascade`, K13's flat-input case, K25's rename, K23's WGSL claim and K32's await rule. The rows below change most what an idea can promise; the evidence is in [verification.md](verification.md).

| # | What ideas assumed | What is actually true | Ideas affected |
|---|---|---|---|
| K01 | v9 condense and harp: "zero GLSL, drive `uProgress` from TS" | Zero GLSL holds. But the playback owner rewrites `uProgress` every frame (0 on single-frame files), synthetic-row identities block the endpoint upload, bonds are inferred from the "from" frame, and one two-endpoint lerp can't stagger per atom without an attribute | Keyframe Relay, Mode Harp, C030 |
| K02 | Quick Look is "mostly wiring" | Public reports say a programmatic click on a blob USDZ after an async export takes the download/View path on iOS 17.5+, and Chrome on iOS won't open blob USDZ; confirm on an iPhone. **Plan for a hosted `.usdz` behind a real `rel=ar` tap** | C110, Place It on Your Desk |
| K06 | `sand_w_cascade` is a real cascade | **A one-frame procedural recreation, not MD.** Cu melt runs are real, but only ~45/34/58 MB sizes are published | C080, burst twin, Scratch Deck's tungsten example |
| K07 | Analytics drops keys, over-reports | Worse: `guide`, `fluid` and `clip` are also dropped, `native_share` fires on abort, and the Worker drops unknown event names (`library_searched` already) | Telemetry, Loop Ledger |
| K09 | A seed makes Remix shareable | Output also depends on pre-roll state, flags, atom-count class and catalogs; encode the resolved look. There is no seed today | C062, Foil Specimens |
| K13 | quickhull3 handles flat input | **Degenerates on exactly planar input**; check planarity, then use quickhull2. Jittered near-planar input gets a valid sliver hull | Object Facts, the die |
| K14–K15 | `math` has no ray-sphere test or eigen solver | Confirmed gaps: hand-write ray-sphere, ray-plane and a Jacobi eigen solve | Picking, knife, True Spin |
| K20 | `onIdle` ends settle work | **`onIdle` is deprecated**: use demand + `invalidate()` and your own fixed-step accumulator | C002, True Spin |
| K21 | Priorities reverse on v10 | Reversal confirmed; negative priorities reorder silently, so readback runs before state is applied | R7 |
| K23 | No conservative depth in WGSL | Outdated for WGSL: Chrome 154 ships `@builtin(frag_depth, greater)`, not yet in the spec. But three r186 never emits it, and its GLSL builder never emits `layout(depth_greater)`, so early-Z is lost on both backends, including `forceWebGL`, a regression from today's `RawShaderMaterial`. Recovering it needs a builder patch or an upstream three change | Gate spike, Deep Dive |
| K28 | iOS haptics only from a direct switch tap since 26.5 | Mostly true: programmatic `label.click()` no longer buzzes (the fix is on the Safari 26.4–26.6 branch; "26.5" comes from library authors), a finger dragged over a real switch ticks once per crossing, and Low Power suppression is unproven | Haptic Moments, Flipper Spin |
| K32 | iOS `share()` fails after any await | **Refuted: `share()` tolerates short awaits** (~5 s activation). Only long encodes need a second tap; Chrome refuses `.usdz` | Make It Mine, Instant Replay |
| K36 | C003: settle "varies ~4× between 30 Hz Low Power iPhones and 120 Hz ProMotion"; a steady 33.3 ms means Low Power | **iPhone Safari rAF is ~60 Hz on ProMotion and 30 Hz in Low Power Mode**; the 4× gap is phone-vs-desktop. A 30 Hz cadence can also be thermal or an un-tapped iframe: label it "30 Hz capped" | C003, Stop-Motion Pocket, embeds |

**Other corrections.** K03 (item 10), K05 (confirmed; item 6), K19 (§2.2), K30 and K31 (ledger) are applied where they bite. Also:
- K04: `diamond_crystal` has 512 atoms, not ≤112, and Learn already shows each molecule's prompt (Twelve Prompts). K08: the gist engine takes no pointer input, so touchable particles are new shader work.
- K10–K11: springs are stable at any `dt` but not dt-invariant while the target moves, and not bit-identical across engines, so Replay Tape stores pose samples. K16: `inCircle`/`inSphere` are canary-only but one-liners at 0.1.0; only Fibonacci and Poisson sampling need hand-rolling. K17: FABRIK holds constraints only through `solve`/`iterate`; forward-only following ignores hinge limits (C031). K18: curl noise is CPU only, and curl3 over simplex3d spikes; use perlin3d, or `mx_noise` on the GPU.
- K22: only **normalized** u8/u16 attributes error on WebGPU r186; `instanceTypeId` is silently widened to 4× memory (R2, Zero-Byte Play). K24: stock velocity applies displacement to the current frame only, so static offsets read as motion. K25: glyph's `breakApart` rename is only proposed, and R3F ≥9.7 + WebGPURenderer suffices (Etched Type). K26–K27: readback allocates per call, pads rows on WebGPU and flips y on WebGL2, and `advance()` draws nothing while a positive-priority `useFrame` is mounted, which Lupi's export path does.
- K29: motion and orientation share one permission, which persists across reloads. K33–K35: `avc1` 1080×1920 needs a device check, deflate-raw needs iOS 16.4+, and Scene Viewer needs the Google app. The judges added that `PassNode` re-renders the scene every pipeline render, so a v10 loupe needs a frozen snapshot.

---

## 7. Suggested sequencing

### First 6 weeks on v9 (one engineer)

| Week | Build | Short-list rank | Effort |
|---|---|---|---|
| 1 | Upgrade pins: fiber 9.6.1 → 9.8.1, drei 10.7.9, one `@react-three/postprocessing`; pin `math@0.1.0` and `@pmndrs/scheduler@0.2.0`. Telemetry: the prop-key test, every new event name added to the Worker's `ANALYTICS_EVENTS` allowlist (K07), Loop Ledger events replacing `view_shared` | Prerequisite | S+S |
| 1–2 | One Motion Kernel + Comfort Budget; Fidget Flick + True Spin (with Object Facts' inertia) | 1, 2 | S+S+S+S |
| 3 | Quiet Idle on scheduler 0.2.0, the idle upload and label fixes, and a `?perf` HUD baseline on the spike's phones | 4, prerequisite | M+M |
| 4 | Gesture Constitution + a v9 Play tray (one pick per pointerdown), Scoped Keys, Edge-Safe Canvas | 3 | M+S+S |
| 5 | Object Facts + Symmetry Detents | 5 | M+M |
| 6 | Keyframe Relay, with the K01 plumbing | 7 | M |

A one-week Wizard-of-Oz fun test runs alongside. After week 6 a lone engineer must choose between Phase 0 and the rest of the v9 list below; each delays the other (decision 13).

**With a second engineer,** B starts the port in week 1 (Phase 0 in weeks 1–2, the gate spike in week 3, then parity on the Joy Ladder), and A runs the six weeks above, then the v9 list in this order: Unfurl cards and `/m/:id` (10); Lupi Daily (11); Remix codes (12); Contact's v9 slice of Neutral tone mapping, mobile baked occlusion and the softbox rig (13); camera Instant Replay on The Shot's v9 adapter (9); Quick Look with hosted USDZ; the thermometer; the Mode Harp once the mode bake has a publisher (8).

### Phase 0 (≈2 weeks; Joy Ladder M0, "It arrives")

v9-safe pins (the canary pins wait for the swap); the R2 repack (normalized attributes to `unorm8x4`, `prop` to 8 bits, flag byte reserved); renderer-agnostic shims; an ExportManager barrier, so a mid-entrance export matches one at rest; Look goldens on today's renderer as the port's "before"; demand frames; and the relay entrance as the first toy "cartridge".

### Gate spike (1 week; M1, "Poke on a real phone")

The TSL impostor and the ripple slot, on a sandbox route, across six device classes: A, an iOS 17/18 iPhone on WebGL2; A-LPM, the same phone in Low Power Mode; B, an iOS 26 iPhone on WebGPU; C, a mid-range Android; D, a laptop with an integrated GPU; E, a desktop with a discrete GPU. It measures early-Z at 1M and 5M atoms, poke latency, tab reloads, a 10-minute thermal soak and fallback program churn, and outputs a go/no-go plus per-class caps. The visibility-buffer contingency (C013) triggers only if early-Z fails.

### Port milestones that each ship a toy (Joy Ladder; opt-in `/next` build)

| Milestone | Weeks | Work | The toy you can feel |
|---|---|---|---|
| M2 "Tap it and it rings" | 4–9 | Platform swap, atom port, dual CI, Warm Start | Poke and burst; parity exit on both lanes and the device lab |
| M3 "Bonds hold on" | 9–10 | Bond port with atom pairs; GPU stagger replaces the relay | Bonds follow every deformer |
| M4 "Sleeps cool, wakes instantly" | 10–13 | Phase map, zero idle frames, Phoenix, Studio as a Look | Snow-globe shake in the main viewer |
| M5 "Glow and melt" | 13–15 | Highlight glow, two-Look blends, burst blur; TRAA only if velocity is proven | Glow; Look blends |
| M6 "Words that shatter" | 15–17 | Glyph label shim | Labels break apart |
| M7 "Share what I just did" | 17–20 | Replay Tape → Instant Replay; Export V2 excludes the fun layer | Toy replays; cut-over on three r187+ |

XR is decided at M2; the default is to defer it. **After the port:** Touch Field toys (wake, heat → thermometer, Section View caps, tug); Contact's directional AO and floor shadow; Ink and Light in the viewer and four Looks with Clear; GPU picking and C009's hover glow; moonshots only after device data (Six Sides first, then Crystal Sand or Chladni Dust with analytic fallbacks).

### What to measure

- **North Star (a draft for you to approve or edit, not a measured target):** the share of first-time viewer sessions with `first_flick` or `first_poke` within 10 s of `viewer_ready` and at least 30 s of interaction (this needs a duration field in `first_minute_summary`). Kill rule: remove a toy whose opt-in rate stays below a threshold you set after 4 weeks behind an A/B arm. Decision 2's first-molecule A/B uses the same metric.
- **Activation:** `first_rotate` within 10 s of `viewer_ready`. **Delight:** `first_poke` AND (`sound_opt_in` OR `replay_opened`). **Share rate:** `clip_shared` ÷ viewer sessions.
- **Guardrails:** dead taps, interrupted arrivals, tap-to-frame p75 by backend, hitches per flick. **Loop events** per template and channel: prepared, handed off, opened, remixed, turn taken.
- **A/B arms:** hero on/off, C60 vs caffeine vs Water, touch mark vs text pill.
- **Couch Test:** five strangers every two weeks, plus a screen-reader user and a switch user each quarter. **Device lab:** weekly runs.

---

## 8. Decisions only the owner can make

**Answered on 2026-09-28: see [decisions.md](decisions.md).**

1. **Motion on the home page.** The recommendation is one hero, still until touched, with zero canvases. That partly reverses the product reset's calm home.
2. **The first molecule.** Water (the reset's choice), C60 or caffeine, A/B'd against the draft North Star.
3. **Audio default.** Proposed: silent in Inspect, quiet in Play with a visible mute, unlocked by a "Hear it" chip, respecting the iOS silent switch; and what muted phones see instead.
4. **XR.** Defer immersive XR and keep iPhone AR on Quick Look, or fork and remount on WebGL (3–4 weeks).
5. **Export V2.** When to cut the V2 profile and rewrite AGENTS.md's "V1 truth"; confirm that cards and clips stay illustrative, outside MCP artifacts.
6. **Chrome budget.** The maximum persistent controls on a 390 px phone, and which of Play chip, Status Island, Rail and Notebook survive.
7. **Palette and plate.** Default plate (Sage, Figure Neutral or paper); brand accent (lime, teal or lupine blue); whether the default element palette may change.
8. **Cost and content owners.** Worker rendering (resvg-wasm); static `/ar` and `/m` hosting; `HF_TOKEN` spend on `/scan`; stewards for new LAMMPS, xtb and GenIce bakes; the 60-day Daily queue, twelve answer cards, and new secrets after week one.
9. **The `/next` lane.** Whether to run a public opt-in v10 build. It means two builds, and its data is self-selected.
10. **Contract amendments.** Add Play as a viewer control; set "lite" messaging for WebGL2-fallback visitors; hold React at 19.2.x and `math` at 0.1.0 while the port settles.
11. **Device lab hardware.** Which phones stand in for classes A–E.
12. **How far from molecules may play go?** You said play need not be anchored in hard science. The judges wanted a real twin per toy, killed C099 Periodic Pinball and C102 Nanokart as "arcade skins with no molecule" (Nanokart was also the worst motion-sickness risk), and briefed round 2 "no new standalone arcade games". This report keeps the twin rule as a label, not a gate; say whether arcade play is in.
13. **Staffing.** One or two engineers during Phase 0 and parity. With one, the port starts after the six-week v9 cut, or the rest of the v9 list waits ([section 7](#7-suggested-sequencing)).
14. **GPU Studio's door.** Keep it as a separate door, or dissolve it into Looks plus the Play chip once it runs in the main viewer at M4.

---

## Appendix: how the brainstorm was run

- **Method.** `pmndrs-math` cloned the repo and ran local micro-benchmarks ([research/bench.md](research/bench.md)); the v10 study ran live npm probes on 2026-09-27, and its brief set the backend tags and re-scoring rules for both reviews. Each judge gave a 1–5 score, a verdict (champion, keep, rework, merge, park, kill), a critique and an improvement, and in round 2 a top 12, a best 15 across both rounds and remaining gaps. Fact-checkers were told to try to refute each claim and to confirm only on decisive evidence.
- **Limits.** Nothing was prototyped. No browser or device runs were possible in the research sandbox, so readback latency, iOS haptics, H.264 configs and Safari limits await a device check. Every threshold in the ideas (hesitation delays, capture cones, slop) is a guess until the Couch Test runs.
