# Round 2 · Pure Joy, with Collectibles, Mastery and Secrets

[← all round-2 ideas](README.md)

## Direction notes

Key decisions:
1. **One foundation makes every joy toy molecule-derived.** Object Facts is a CPU module baked offline for the gallery: centre of mass, the inertia tensor with a hand-written Jacobi solve, symmetry from libmsym at a stated tolerance, a quickhull3 hull with stable faces and solid-angle odds, and rings. That answers "only a real 3D molecule can do this":
   - The flick coasts on the real inertia, and the Dzhanibekov flip is the secret.
   - Detents sit on real Cn axes.
   - The dial clicks n times per turn.
   - The music box plays the geometry.
   - The die rolls over the real hull.
   - Letters hide in real projections.
   - Sounds flutter at n × rev/s.
2. **Nearly everything is DOM/CPU and ships on v9.** It runs the same on the WebGL2 fallback and old iPhones, and no throwaway GLSL is written. Only the in-sphere glints (Temperaments), foils and pluck blooms ride R2, R3, R5 and R6, as uniform If() branches.
3. **Secrets are states, not gestures.** This avoids the contested tap, double-tap and long-press map and gives every secret a keyboard route and screen-reader text. Keys are scoped to Play mode, because Space and the arrows already step trajectories. D2 owns the final map.
4. **Personality through light and voice only.** There is no squish, tilt sag, idle atom sway or hue cycling. The rigid group transforms that remain (dice tray, desk) live in explicit Play spaces, are reset before capture, and have picking and labels off.
5. **Anti-dark-pattern rarity.**
   - Foil is a pure function of the remix code, with published odds.
   - Rolls are unlimited, with no pity timers and no counters.
   - Every finish has two roads (luck or a feat), and a "Show all finishes" setting unlocks everything.
   - Accessibility looks are never locked.
   - Finishes are rim- and case-only, so atom colour stays data (Gold leaf keeps CPK cores so it can't read as Au).
6. **Sound policy settles the round-1 split.** Inspect is silent, and Play is quiet with a visible mute. UI cues respect the iOS silent switch (the ambient session); only the Music Box offers an explicit playback toggle. Every cue is captioned, and iOS haptics are promised only on direct DOM-chip taps.
7. **No streaks or FOMO.** Missed days are blank, past dares are replayable, and seasonal twists recur yearly and can be previewed.
8. **Flash safety is designed in.** Wind speed is capped at 3 rev/s so each atom pulses 3 Hz or less, pulse luminance changes stay under 10%, and D2's flash guard is the backstop.

Honest unknowns:
- The symmetry yield on MD and relaxed conformers (caffeine is effectively C1).
- The Shadow Alphabet letter yield, which needs a 20-molecule pilot before any promise.
- The Euler's-disk and heavy-top toy models need tuning.
- The iOS 26.5 switch haptics need a device test.
- No FPS or thermal numbers exist. Phone budgets are stated only as work per frame.

Deliberately left out:
- Arcade games without molecules, leaderboards, global counters (which need a storage cost owner), free text on cards, and location-based seasons.
- Webcam and XR.
- HRTF binaural audio (panner cost on phones).
- Idle camera dream tours.
- Any "real physics" claim beyond classical rigid-body models with labels.

Sources consulted: libmsym (https://github.com/mcodev31/libmsym), the tennis racket theorem (https://en.wikipedia.org/wiki/Tennis_racket_theorem), the solid-angle dice model (https://polytope.miraheze.org/wiki/Fair_die, https://arxiv.org/html/2609.01643), Euler's disk (https://www.nature.com/articles/35009017), WCAG 2.3.1 (https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html), Screen Wake Lock (https://web.dev/blog/screen-wake-lock-supported-in-all-browsers) and AudioSession (https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type). The math@0.1.0 APIs (quickhull3, polygon2, quat.setAxisAngle/rotationTo/slerp/fromMat3, spring.update/dampAngle/fromResponse, mulberry32.create/next, random.float, easing.cubicIn, spherical) were checked against the tag in the local clone.

<a id="r2-joy-and-mastery-01"></a>
## Object Facts: the molecule's own toy data (mass, axes, symmetry, hull, rest faces)
`R2-joy-and-mastery-01` · foundation · effort M · judges mean **4.2** (E5 P4 A3 Pr5 M4; champion 3, keep 2) · self-scored fun 2 / visual 1 · perf neutral

> One small, versioned module computes the facts that make this molecule a particular physical object: centre of mass, inertia tensor and principal axes, rotor class, symmetry axes and planes, convex hull with stable resting faces, and ring centres. Every joy toy in this set derives from the real specimen rather than from a game skin.

**Framing:** capability->problem

**Builds on:** new (feeds C021 detents, C039's hull, C090, C094 stamps; enables every toy in this set)

**Problem:** Round 1's non-science fun had no molecule in it (C097, C098, C099 and C102 scored lowest). C021's detents are art-directed angles that feel the same on caffeine as on C60. Nothing gives a toy access to what makes a flat benzene different in the hand from a round buckyball. math@0.1.0 ships quickhull3 and polygon2, but it has no eigen solver and no symmetry finder.

**Solution:**

Add `packages/core/src/objectFacts/` as pure TypeScript with no three.js. `computeObjectFacts(types, positions) -> ObjectFactsV1` has five parts.
(1) **Mass.** Centre of mass from ELEMENT_DATA masses. The inertia tensor about the CoM (amu·Å²) adds each atom's own solid-sphere term (2/5·m·r² with the display radius), so linear molecules (O2, N2O) get a finite axial moment. A hand-written cyclic Jacobi 3x3 eigen solve (~40 lines) gives principal moments Ia≤Ib≤Ic and axes. From those come the rotor class (spherical / oblate / prolate / asymmetric / linear) and Ray's asymmetry κ, computed from the rotational constants (∝1/I).
(2) **Hull.** math `quickhull3` runs on atom centres. For molecules of 500 atoms or fewer, it runs on 12 icosahedral sample points per atom sphere instead, so a 2-atom NaCl or 3-atom water still gets a solid. Coplanar triangles are merged into faces. A face is stable when the CoM's projection lies inside it (`polygon2.containsPoint` in the face plane). Each stable face gets its centroid solid angle as a rest probability (the solid-angle model: https://polytope.miraheze.org/wiki/Fair_die, https://arxiv.org/html/2609.01643). The face adjacency graph is kept for rolling.
(3) **Symmetry.** Cn axes (n = 2..8), mirror planes and the inversion centre. Gallery entries are baked offline with libmsym (MIT, https://github.com/mcodev31/libmsym, Python wrapper pymsym) at a stated tolerance. User files of 200 atoms or fewer get a runtime fallback: a hand-written candidate search over principal axes, atom-to-CoM directions and pair midpoints, keeping only operations that map every atom onto a same-element atom within tolerance.
(4) **Rings.** Small rings (3–8 members) from inferred bonds, with centres and normals.
(5) **Planarity.** A planarity RMS.
Output is plain JSON `lupi.object-facts.v1` with provenance {method, tolerance, sourceSha, tool versions}. It is baked by `tools/build-object-facts.mjs` next to the preview builder, which already binds source SHA. The offline bake can take hulls up to ~50k atoms (round 1 measured a 100k-point quickhull3 at ~87 ms in Node), so the rough octahedral diamond really is a d8. At runtime it runs in a worker for user files up to 20k atoms. Periodic cells are treated as boxes.

**Experience:** Invisible by itself. Learn gains a one-line disclosure, for example: "Spins like a flat plate (oblate top) · 6-fold symmetric (D6h, ±0.05 Å) · rests on 2 faces", with the same text for screen readers. Desktop and phone are identical. For a user file, a worker computes it once on load in a few milliseconds for small molecules. Nothing runs per frame.

**Tech:** math@0.1.0: quickhull3 (flat xyz in, triangle indices out; allocates), polygon2.containsPoint/area/centroid, vec3, mat3, quat.fromMat3/setAxisAngle, obb3.set. Hand-written Jacobi eigen and symmetry candidate search. Offline libmsym/pymsym (MIT). Web Worker. No GPU.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (renderer-agnostic)

**v9 slice:** All of it: the core module with golden tests (CO2 linear, benzene oblate with Ic≈2Ia, C60 spherical, water asymmetric) plus the offline bake for the 104 gallery entries.

**WebGL2 fallback:** Identical (CPU only).

**Where in code:** New packages/core/src/objectFacts/*; new tools/build-object-facts.mjs, reusing parseFirstFrame and source-SHA binding from tools/build-gallery-previews.mjs; output packages/ui/src/gallery/object-facts.json; masses from packages/core/src/elements.ts (ELEMENT_DATA).

**Risks:** MD snapshots and relaxed conformers are rarely exactly symmetric, and methyl hydrogens break caffeine down to C1. Symmetry secrets will therefore concentrate on rigid, high-symmetry entries (C60, benzene, CNT, diamond, water). An "approximately symmetric" tier would need its own wording. Inferred-bond rings can be wrong on odd files. quickhull3 allocates, so it stays in the worker. Tolerance choices change results, so they must be versioned.

**Honesty:** These are geometric facts about this file's coordinates at a stated tolerance, not about the real molecule in solution. One conformer's symmetry is not the molecular point group. The UI always says "in this file" and shows the tolerance. Nothing here enters deterministic export or changes atoms.

**Judges:**

- E 5/champion: A pure-TS core module (CoM, inertia and principal axes, rotor class, symmetry, hull rest faces, rings) with golden tests. It feeds about a dozen toys: True Spin, detents, dice, music box, shadow alphabet, Desk, Symmetry Snap, Kaleidoscope, Plumb Line. It costs zero GPU and ships on v9. Hand-written Jacobi and an offline libmsym bake are realistic. *Improve:* Bake for the gallery offline and compute lazily in a worker for user files. Mark symmetry as approximate for relaxed conformers.
- P 4/champion: Pure data, but it's the single foundation behind the most molecule-native toys across both rounds: True Spin, symmetry detents, the die, the music box, the Desk dial, Symmetry Snap, Kaleidoscope, Plumb Line and the Secret Pack. All CPU, all v9. *Improve:* Bake it for the 12 curated molecules and the quick picks first, with golden tests, and claim symmetry only where it is exact in the file.
- A 3/keep: This is the data (axes, rest faces, rings) that composed views are made from. *Improve:* Share it with fm-05, and bake the axes for the whole gallery.
- Pr 5/champion: One tested CPU module (centre of mass, inertia tensor, symmetry, hull, rings) feeds detents, True Spin, Twelve Prompts, secrets, dice and the music box. Its facts are the Derived rung, computed from the file, and it ships on v9. Risk: MD snapshots and relaxed conformers are rarely exactly symmetric. *Improve:* Bake the curated 12 first, and state the tolerance in Learn.
- M 4/keep: Pure CPU facts (rings, extent, symmetry, rotor class) feed screen-reader descriptions and meaningful detents. *Improve:* Expose the facts as text in PE-05's scene description, and publish symmetry detents only where tolerances are honest.

<a id="r2-joy-and-mastery-02"></a>
## The Handling Loop: first secret in 20 seconds, first foil in a week
`R2-joy-and-mastery-02` · flagship · effort L · judges mean **3.4** (E3 P5 A3 Pr3 M3; champion 1, keep 3, merge 1) · self-scored fun 5 / visual 4 · perf neutral

> A designed arc from the first flick to a returning visitor's notebook. Every molecule has one easy secret found by accident, a quiet meter says more are hidden, a toy tray turns the specimen into a die, a music box or a desk toy, and a week-scale collection pays off in cosmetic foils. Nothing is timed against you.

**Framing:** problem->solution

**Builds on:** C021+C094+C062+C088+C019 (+ Object Facts and the toys in this set)

**Problem:** Round 1 produced good toys but no loop between them. Toys can't be found, which every judge flagged, and the only come-back mechanic is the Daily, whose season is short. The joy lens needs a structure in which play, collection and mastery feed each other with no streaks, no FOMO and no nagging. D1 owns seconds 0–60 from `/`. This idea owns what happens after arrival, across sessions.

**Solution:**

Beat by beat, each beat derived from Object Facts:
**Beat 1 (0–20 s, first flick).** True Spin makes the first coast feel like this object: C60 glides like a marble, benzene like a plate. Each curated molecule has one "beginner's secret" with a wider capture cone on the first find per session, so a casual flick lands on it:
- C60: the 5-fold pentagon view
- benzene: the 6-fold view, or edge-on "Flatland"
- water: the 2-fold view
- caffeine: the ring window
On settle it clicks, an n-note chord plays, an ink rosette appears, and an ink stamp of this molecule at this pose flies to a small Notebook tab.
**Beat 2 (20–40 s).** The tab reads "1 · 3 more here". Tapping it opens the Notebook sheet, which rides the sheet (C026) so the molecule stays visible. It shows the stamp and hint 1 of the next secret. Ignoring it costs nothing.
**Beat 3 (40–90 s).** The Play chip (D2's grammar) opens a tray of three molecule-derived toys: Roll (every molecule is a die), Wind (music box) and Desk. Each first use stamps a verb.
**Beat 4 (sessions 2+).** The home page shows a zero-canvas DOM Notebook cover with your last three ink stamps. One Almanac dare is a reason to open a new molecule. Feats unlock finishes, and about 1 roll in 24 comes up Foil.
**Beat 5 (share).** Feat cards and dare links, spoiler-guarded.
**Loop rules:**
- at most one unsolicited toast per minute
- sound silent until Play is chosen
- every beat has a keyboard route, screen-reader text and a reduced-motion still
- no loss states and no counters of what you missed
- the Clear and high-contrast looks are never locked
**Instrumentation (PII-free):** first_secret (id and a seconds bucket), toy_first_use, notebook_opened, feat_unlocked, dare_opened, share_feat.
**Advice to D1 on the landing molecule:** C60 or benzene (high symmetry makes the first secret easy and beautiful), with caffeine as the second visit (the flip).

**Experience:** Desktop: flick with mouse or trackpad; N opens the Notebook; the tray keys are scoped to Play mode. Phone: a thumb flick, the Notebook tab at the thumb edge, the tray in the bottom sheet, Android haptics on locks, iOS haptics only on direct taps of tray chips. Screen reader: the atom cursor (D2) plus "seek next secret" announcements. Reduced motion: each beat is a crossfaded still. Phone budget: all loop logic is CPU state machines on events, with no continuous work beyond the existing orbit.

**Tech:** Play registry in packages/ui/src/play (lazy toy chunks with a bundle budget); @pmndrs/scheduler 0.2.0 jobs that invalidate until settled (demand); math/time springs for stamp flight; localStorage with try/catch; an analytics taxonomy extension.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for demand frames; R2/R6 later for in-scene glow)

**v9 slice:** The whole loop on v9: True Spin, symmetry detents, the Notebook with SVG ink stamps, the dice tray and music box with DOM ink ticks. Only in-scene glows and foils wait for R2, R3 and R6.

**WebGL2 fallback:** Identical: the loop is CPU/DOM, and in-scene extras are uniform branches that also run on the WebGL2 backend.

**Where in code:** New packages/ui/src/play/ (registry, beats); the C021 camera controller replacing drei OrbitControls in packages/ui/src/app/ViewerScene.tsx (~731-742); landing cover card in packages/ui/src/landing/ (DOM only); packages/ui/src/analytics/events.ts.

**Risks:** Scope. Stage it: v1 is True Spin, detents, the Notebook and one beginner's secret for each of the 12 curated molecules. A home cover card needs an owner call on home content (it is static DOM). It needs content-steward curation, and psychoactive gallery entries stay out of kid-facing and dare pools. Beginner's-luck tuning must not make detents grab during measurement, so detents are off while measuring or selecting.

**Honesty:** Each toy carries its own honesty line, and secrets are stated as facts about this file ("6-fold within 0.05 Å"). Play never presents itself as a result. The fun layer (camera coasts, tray transforms, finishes) stays out of deterministic export.

**Judges:**

- E 3/keep: A good product arc, but from an engineering view it bundles other scored ideas into an effort-L umbrella. *Improve:* Stage v1 as True Spin, detents, the Notebook and one beginner's secret per curated molecule.
- P 5/champion: The arc a playtester asks for: a first secret found by accident within 20 s, a quiet 'more here' meter, a tray of object toys, and a week-scale payoff, with no loss states. The risk is scope (L). *Improve:* v1 is True Spin, symmetry detents, one beginner's secret per curated molecule, and the Notebook. Measure time-to-first-secret in Couch Test before adding foils.
- A 3/keep: The arc is fine, but it stacks ink rosettes, chords, a meter, dice, a music box and foils on top of the specimen. *Improve:* Scope v1 to True Spin, the detents and the Notebook. Add foils later.
- Pr 3/merge: Merge into R2-joy-and-mastery-12. The retention arc is the right idea, but as stated it is an umbrella of effort L. *Improve:* Stage a v1 of True Spin, detents, the Notebook and one beginner's secret for each of the curated 12.
- M 3/keep: Nothing is timed, but it is an L umbrella whose accessibility depends on its parts. *Improve:* Stage v1 as True Spin, detents and the Notebook, with every unlock keyboard-reachable.

<a id="r2-joy-and-mastery-03"></a>
## True Spin: flicks coast on the real inertia tensor, with a tennis-racket secret
`R2-joy-and-mastery-03` · toy · effort S · judges mean **4.4** (E5 P5 A4 Pr4 M4; champion 2, keep 3) · self-scored fun 5 / visual 3 · perf neutral

> The flick coasts on this molecule's real mass distribution, so C60 spins like a marble and benzene like a plate. An asymmetric molecule spun end over end about its middle axis flips over by itself: the Dzhanibekov effect, as a hidden secret you can catch.

**Framing:** problem->solution

**Builds on:** C021+C003 (+ Object Facts)

**Problem:** C021's flick coasts on an isotropic spring, so every molecule feels the same in the hand and the first gesture is generic. The playtester wanted a spin record, while the art director wanted no on-canvas rev/s dare. Mastery needs to belong to the molecule, not to a number.

**Solution:**

**The coast.** C021's release velocity (from coalesced pointer events) becomes body-frame ω. The coast integrates torque-free Euler equations (Ia·ω̇a = (Ib−Ic)·ωb·ωc, and so on) with Object Facts' principal moments. Integration is RK4 at 1/240 s substeps in a hand-written fixed-step accumulator inside a scheduler `physics`-phase job, since 0.2.0 has no fixed step. A frame-rate-independent exponential decay of |ω| (τ ≈ 3 s) settles it, and below a threshold it hands off to C021's detent springs (`spring.dampAngle`). It is camera-only: the camera applies the inverse rotation, so atoms and export are untouched. A free body rolls, so C021 must be a quaternion (trackball-style) controller that re-levels its up-vector on settle.
**How each molecule behaves.** Spherical tops (C60) behave exactly as today. Symmetric tops show gentle coning when spun off-axis. Asymmetric tops (caffeine, water, aspirin) spun near their intermediate axis flip 180° periodically (https://en.wikipedia.org/wiki/Tennis_racket_theorem).
**The secret.** A flip is detected as a sign change of the intermediate-axis projection of the angular momentum in the body frame. It plays a two-note chime, shows the caption "Flip! (tennis-racket effect)" and stamps the Notebook. The hint ladder: "Some molecules dislike spinning about their middle" → "Throw caffeine end over end" → the key route.
**Mastery.** Per-molecule personal bests (longest steady spin, flips in one throw) appear only in the Notebook. There is no readout on the canvas, which settles the art director and playtester split.
**Keyboard** (Play-mode-scoped; D2 owns the final map): Shift+1/2/3 spins about axis a, b or c at a fixed rate with a tiny seeded perturbation, so the b-spin flips. A catch key stops it; detent-step keys follow C021.

**Experience:** Desktop: a mouse or trackpad flick; caffeine thrown end over end tumbles and flips while C60 glides. Phone: a thumb flick, with the angular-velocity cap inherited from C021. The analytic and fixed-step integration gives the same path at 30, 60 and 120 Hz, including Low Power Mode. Sound: a whoosh with blade-pass flutter (Sound Kit). Android: a short vibrate on a flip. iOS: a caption instead (no drag haptics after 26.5). Screen reader: polite aria-live "spinning about the middle axis… flipped", rate-limited. Reduced motion: no coast; a spin key shows three crossfaded stills (before, mid-flip, after) with a caption. Phone budget: three ODEs × 4–8 substeps a frame on the CPU, which is negligible, and demand frames once settled.

**Tech:** math@0.1.0 quat (setAxisAngle, multiply, normalize, invert, fromMat3), vec3, mat3, spring.dampAngle/fromResponse; hand-written RK4 and accumulator; @pmndrs/scheduler 0.2.0 physics-phase job that invalidates until settled, then onIdle; getCoalescedEvents feature-detected.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R7 for phases and demand frames)

**v9 slice:** All of it: the C021 controller plus the Euler coast, with scheduler 0.2.0 on v9.

**WebGL2 fallback:** Identical (camera-only CPU).

**Where in code:** The C021 controller replacing drei OrbitControls in packages/ui/src/app/ViewerScene.tsx and packages/ui/src/app/CameraManager.tsx; moments from packages/core/src/objectFacts.

**Risks:** Asymmetric coasting can read as a wobbly bug. Tune it so flips need a deliberate, mostly b-axis throw, and so a casual drag ends in the usual clean coast. Vestibular load: keep C021's angular-velocity cap, and the camera never moves without input. Taps during a coast must catch rather than pick.

**Honesty:** Chip: "Spin uses this file's mass distribution (classical rigid body). Real molecules don't spin like this at this speed; display only." Camera pose only; atoms and export are unchanged.

**Judges:**

- E 5/champion: A small camera-only change on v9 with a real physical payoff: torque-free Euler equations integrated with RK4 at 1/240 s in a hand-written accumulator, so C60 glides like a marble and the Dzhanibekov flip is a findable secret. It hosts pocket-04, pocket-06 and cross-03. It needs one convention: camera-equivalent rotation with the environment and lights rotated. *Improve:* Implement it as a camera-equivalent transform with sig-02's env-rotation uniform so picking, labels and export are untouched. Only a deliberate throw about the b-axis should flip.
- P 5/champion: Every flick feels like this particular object: C60 glides like a marble, benzene like a plate. The Dzhanibekov flip is the biggest 'wait, what?' in the whole list, and only a real 3D mass distribution can do it. S effort, v9, camera-only. The risk is a wobble that reads as a bug. *Improve:* Absorb Weightless. Require a deliberate middle-axis throw for flips, so casual flicks coast cleanly, and put 'Show me the flip' in the Notebook's hint ladder.
- A 4/keep: Each molecule coasting on its own inertia gives it a distinct feel: motion as identity. The risk is that asymmetric coasting reads as wobble. *Improve:* Host cross-03 and pk-04. Keep casual flicks clean, turn the object under the world-fixed rig, and hand off to fm-05's detents.
- Pr 4/keep: The core C021 flick becomes a physics truth: C60 spins like a marble, benzene like a plate. It is small, ships on v9, and is camera-only, which is safer than Weightless rotating the root group. It hosts cross-03, pocket-04 and pocket-06. *Improve:* Tune it so a casual flick still ends in a clean coast, and keep C021's angular-velocity cap.
- M 4/keep: Host for CP-03. The fixed-step physics runs wall-clock exact at 30 Hz, reduced motion gets three stills, there are spin keys, and it keeps C021's angular cap. *Improve:* Allow flips only on a deliberate throw, and turn them off under Gentle so a casual flick never tumbles unexpectedly.

<a id="r2-joy-and-mastery-04"></a>
## Symmetry Detents: find the real axes, land them clean, chain them
`R2-joy-and-mastery-04` · toy · effort M · judges mean **4.4** (E4 P5 A5 Pr4 M4; champion 1, keep 1, merge 3) · self-scored fun 4 / visual 4 · perf neutral

> The molecule's real rotation axes and mirror planes become hidden detents. Coast onto a true 5-fold axis of C60 and it clicks into a pentagon mandala with a five-note chord; land it clean with no correction and chain different axes for a combo.

**Framing:** capability->problem

**Builds on:** C021+C041+C094+C090 (+ Object Facts)

**Problem:** C021's detents are art-directed hero angles that don't differ by molecule. It needed a quiet, opt-in mastery layer, and "perfect detent chains" were never defined. Nothing rewards a stranger for turning a molecule until they see it well, and C090 only gave rotation a goal as a target puzzle.

**Solution:**

**Detents.** From Object Facts, each Cn axis gives two view directions and each σ plane gives an edge-on view. C60 (Ih) has 6 C5, 10 C3 and 15 C2 axes, which is 31 axes and 62 views. Benzene (D6h) has a C6 axis and six in-plane C2 axes. These become symmetry detents in C021's set, with a ~6° capture cone and a firmer spring near alignment. The roll about the view axis is set so the pattern stands upright. At lock, the camera eases its FOV narrower (a camera-only dolly-zoom) so the view reads as a flat mandala, or uses the ortho path where available.
**The lock.** A click in the current Look's material, an n-note arpeggio (a C2 is an interval, a C5 is pentatonic), and a thin n-spoke ink rosette in the Illustrate voice as a DOM SVG overlay for 1.2 s, with the caption "Looking down a 5-fold axis".
**A clean landing** means the analytic coast would have stopped within 2° of the axis anyway, so the correction spring did almost nothing. It earns a softer second chime and a gold tick.
**A chain** is clean landings on k different axis orders within 20 s, for example C5 → C3 → C2, a "Trifecta".
**The Notebook axis map** for each molecule is an orthographic SVG sphere with a dot per view direction, found or unfound ("C60: 17 / 62 views").
**C1 molecules** have no axes, and say so with a secret of their own: "Nothing repeats — one of a kind."
**Keyboard** (Play-scoped): cycle through found axes, and a "seek axis" key springs to the nearest unfound one. That counts as found but not clean, so keyboard and motor-impaired users can collect everything.
**Screen reader:** "3-fold axis, 1 of 10 found."
**Detents are suspended** while measuring or selecting.

**Experience:** Desktop: flick and feel the notch as the coast approaches an axis. Phone: a thumb flick, an Android haptic on lock, and on iOS a "Keep this view" chip whose direct tap fires the switch haptic. A locked mandala offers the ink sticker or card (C105 via D4). Reduced motion: detents jump by crossfade and the rosette is static. Phone budget: angle tests against at most ~60 directions per frame while coasting, then sleep.

**Tech:** Object Facts axes (libmsym bake); math quat.rotationTo/getAngle/slerp, spherical.setFromVec3/angleTo, spring.dampAngle/fromResponse; scheduler job; SVG overlay; Sound Kit cue bus; localStorage.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R8 optional: in-canvas glyph ink rosette)

**v9 slice:** All of it, with axes baked offline for the gallery.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/ui/src/play/symmetryDetents.ts; the C021 controller; the Notebook axis-map component; packages/ui/src/gallery/object-facts.json.

**Risks:** Detents that grab too hard fight free inspection, so capture is soft outside Play mode and off during measurement. The molecule pool is limited to rigid, symmetric entries. Perspective views down an axis look only approximately n-fold, which is why the FOV narrows. A dolly-zoom is a mild vestibular cue: skip it under reduced motion.

**Honesty:** Axes are found in this file's coordinates at a stated tolerance ("5-fold, within 0.05 Å"). The rosette is ink UI, not data. Camera only, outside export.

**Judges:**

- E 4/keep: Real Cn and σ detents with soft capture cones, camera-only on every backend, and it hosts flagship-05's ring, plane and principal fallbacks. Detents that grab too hard fight inspection. *Improve:* Keep capture soft outside Play and off during measurement.
- P 5/champion: Coasting onto a true 5-fold axis and clicking into a pentagon mandala with a five-note chord is the fidget-spinner click, plus mastery in clean landings and chains. This is the core loop of the first minute. *Improve:* Absorb flagship-05's detents for low-symmetry molecules, keep capture soft outside Play, and give combos Juice Pass feedback.
- A 5/merge: Host: R2-first-minute-flagship-05. The mandala lock is one of the most beautiful ideas in the round: the FOV narrows at a true axis so C60 reads as a flat pentagonal rosette with its roll set upright. *Improve:* Carry it into fm-05 as that idea's mode for symmetric molecules, along with the chain combos.
- Pr 4/merge: Merge into R2-first-minute-flagship-05. The chords and chains are good mastery on top of the same symmetric detents. *Improve:* Make it the opt-in mastery layer.
- M 4/merge: Merge into FM-05. Its symmetry axes deepen FM-05's detents; the chaining combo is a mastery layer. *Improve:* Keep combos untimed and soft-capture for tremor.

<a id="r2-joy-and-mastery-05"></a>
## Molecule Music Box: every axis of every molecule is a different tune
`R2-joy-and-mastery-05` · toy · effort M · judges mean **3.8** (E4 P5 A3 Pr3 M4; keep 2, merge 3) · self-scored fun 5 / visual 3 · perf neutral

> Wind the molecule about one of its axes and it plays itself like a music-box cylinder. Each atom is a pin, its height along the axis picks the note and its element picks the timbre, so symmetric molecules play repeating phrases, benzene drones, and a nanotube climbs a scale.

**Framing:** capability->problem

**Builds on:** C041+C073+C093+C021 (+ Object Facts)

**Problem:** C073's Pluck is honest sonification but needs baked modes for 10–20 molecules. C093's Simon was judged dated and generic. Sound is opt-in, so most players hear nothing. There's no idle-hands sound toy that belongs to a molecule's shape, and blind users have no way to hear a 3D structure.

**Solution:**

**Setup.** Music Box mode comes from the Play tray or Desk Mode. You pick an axis: the principal axis by default, or any symmetry axis from Object Facts. The camera looks perpendicular to it with the axis vertical on screen. A fixed ink "comb" line sits at the front meridian.
**Pins.** Each atom is precomputed as a pin (height h along the axis, azimuth φ0, radius r). A pin plucks when its azimuth crosses the front meridian, so each atom plays once per turn. This is O(N) per frame, trivial for N ≤ 1,200. Larger molecules use heavy atoms only, or 64 azimuth buckets.
**Notes.**
- pitch: h quantised onto 10 steps of a two-octave scale (pentatonic by default; Almanac rotates the modes)
- timbre: the element voice from Temperaments
- loudness: rises with distance from the axis, so atoms on the axis barely sound
- panning: by screen x
**Input.** A horizontal drag winds it 1:1 like a crank. A flick spins it up, and it winds down on True Spin's decay (a natural ritardando). Tempo caps: at most 3 rev/s, so each atom pulses 3 Hz or less by construction, and at most 8 notes/s overall with voice stealing.
**The payoffs are the geometry:**
- benzene about C6: its six carbons share one note and its six hydrogens another, a drone (secret "Drone")
- C60 about a C5: a phrase that repeats five times per turn
- CNT (6,6) about its tube axis: rings at even heights, a climbing arpeggio
- caffeine: a unique, non-repeating tune
**Visuals.** Plucked atoms get a soft rim bloom (150 ms attack, 400 ms decay, under a 10% luminance change) through the R2 flag byte and bloom on v10, and DOM ink ticks on v9.
**Tune codes.** `?box=<molecule>.<axis>.<bpm>.<scale>` replays an identical, deterministic song. An optional WAV comes from OfflineAudioContext.
**Silent switch.** UI cues respect the iOS silent switch (`navigator.audioSession.type = 'ambient'`, WebKit only). Music Box alone offers an explicit "play through silent mode" toggle that sets 'playback' (https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type).

**Experience:** Desktop: drag or two-finger horizontal scroll to wind; Play-scoped keys step one pin or auto-wind, and +/- change tempo. Phone: a thumb crank strip in the bottom thumb zone and a flick to spin. The AudioContext starts on the first gesture. Screen reader: fully playable by ear, with an aria-live axis name and pin count. Reduced motion: the molecule stays still while an ink playhead dot steps along a static projection, one still per note, with the same audio. Phone budget: O(pins) CPU per frame while winding, at most 8 Web Audio voices, and sleep when stopped.

**Tech:** Web Audio: one shared context; OscillatorNode/FM voices; StereoPannerNode; DynamicsCompressorNode; OfflineAudioContext for export. math quat/vec3 azimuths and spring decay; scheduler job; R2 unorm8x4 flag byte and useRenderPipeline bloom (v10); SelectionMarkers-style DOM ticks (v9).

**Backend:** DOM/CPU (in-scene pulse [GPU+GL2] on v10)

**Rides (v10 requirements):** R2 (flag byte), R6 (bloom); audio and logic ride nothing

**v9 slice:** The whole toy with camera winding and DOM ink ticks. The rim bloom waits for R2 and R6.

**WebGL2 fallback:** Identical audio and logic. The bloom's pulse depends on R6 fullscreen passes working on GL2 (expected, unverified); without them the rim tick alone plays.

**Where in code:** New packages/ui/src/play/musicBox.ts; the Sound Kit replacing packages/ui/src/lib/clickSound.ts internals; SelectionMarkers.tsx for v9 ticks; the C021 controller for winding.

**Risks:** Big molecules turn to mush, so cap the pins and let heavy atoms lead. The pentatonic scale can sound samey, so offer three scales. Players may misread the height-to-pitch mapping as a spectrum, which the copy and a hand-off to Pluck address. Flash safety rests on the 3 rev/s cap plus D2's flash guard. Sound taste needs a designer's ear, and testing on phone speakers.

**Honesty:** "A music box made from this molecule's shape: notes come from atom height along the axis, not from its vibrations. For the real spectrum, try Pluck." Camera and audio only. Outside export.

**Judges:**

- E 4/keep: O(N) comb crossings per frame plus Web Audio is trivially cheap and ships on v9. The in-scene pulse later rides the flag byte. It hosts cross-01's element pads. *Improve:* Cap pins by atom count, schedule notes with Sound Kit's predicted-time rule, and caption that pitch is not a spectrum.
- P 5/merge: Winding a molecule to play its shape as a tune is one of the best sound toys here: symmetric molecules repeat phrases, and a nanotube climbs a scale. It has the same core as scout-01. Host: R2-cross-pollination-scout-01. *Improve:* Merge, bringing its axis choice and per-element timbres.
- A 3/keep: The comb is one more overlay line across the specimen. *Improve:* Host cross-01. Draw the comb as a 1 px ink hairline, and make the per-atom pluck response the single hover signature.
- Pr 3/merge: Merge into R2-cross-pollination-scout-01. It duplicates the Music Box Molecule. *Improve:* Carry its axis choice into cross-01.
- M 4/merge: Merge into CP-01. Capping at 3 rev/s bounds pulses at 3 Hz or less by construction, and the reduced-motion playhead dot is the best design among the music boxes. *Improve:* Bring the tempo caps and the playhead into CP-01.

<a id="r2-joy-and-mastery-06"></a>
## Every Molecule Is a Die
`R2-joy-and-mastery-06` · toy · effort M · judges mean **3.4** (E4 P4 A3 Pr3 M3; keep 4, park 1) · self-scored fun 5 / visual 4 · perf neutral

> Roll any molecule across a felt tray and it tumbles over its real convex-hull edges, coming to rest on a face where its real centre of mass is stable. Benzene lands like a coin, the rough-octahedron diamond is a d8, the nanotube rolls away like a pencil, and the face it lands on picks your next Remix.

**Framing:** capability->problem

**Builds on:** C062+C032 (rigid salvage)+C039 (hull) (+ Object Facts)

**Problem:** Remix (C062) is a button with a random number, shake-to-roll needs a sensor prompt, and C032's toss was killed as cartoon physics (squish, XPBD). Nothing makes the roll itself a toy that belongs to the molecule.

**Solution:**

**Faces and odds.** Object Facts supplies the hull faces, the stable faces and each one's centroid-solid-angle probability. That model describes a gentle roll well and bouncing throws badly (https://polytope.miraheze.org/wiki/Fair_die), which is exactly why the animation is a gentle roll.
**A roll.**
1. Pick the outcome first with seeded mulberry32, weighted by those probabilities.
2. Plan a path over the hull's face-adjacency graph: a weighted random walk of 3–9 edge-rolls that ends on the chosen face.
3. Animate each step as a rigid rotation about the shared edge, pivoting on the tray. Use `quat.setAxisAngle` about the edge, `easing.cubicIn` so it accelerates like gravity, and a felt "thock" per edge.
4. The last edge rocks once on an underdamped spring (ζ ≈ 0.4).
**Teeter.** If the CoM projection is within 2% of an edge, the molecule teeters before it falls (secret "Teeter").
The same seed always replays the same roll, and the roll code is shown.
**The tray.** A distinct Play space: the molecule scales down into a felt dish with a contact shadow. It is the only place the molecule moves as a rigid group. It is never squashed. The group matrix returns to identity on exit, picking is disabled in the tray, and labels hide.
**Uses:**
- "Roll for a look": each stable face maps to a point in C048's curated manifold, so every result looks designed
- a Desk Mode fidget
- a brag stat ("caffeine is a d11 whose flat face comes up 38%")
- Almanac dares ("roll a natural")

**Experience:** Desktop: the Roll button or a Play-scoped key, or drag-and-release in the tray, where the throw direction affects only the path's look and never the odds. Phone: tap the Roll chip. That direct DOM tap fires the iOS switch haptic, and Android gets a vibrate per edge thock. Shake works through D2's shared sensor flow. Screen reader: "Rolled caffeine: 5 tumbles, landed on face 3 of 11, the flat ring face." Reduced motion: no tumble; one crossfade to the resting pose plus a thock. Phone budget: 3–9 quaternion keyframes and a spring, CPU only, with demand frames when at rest.

**Tech:** Object Facts hull and rest faces (math quickhull3, polygon2); math quat.setAxisAngle/multiply/slerp, vec3, mulberry32.create/next plus random.float for the weighted pick, easing.cubicIn, spring.update; group transform in R3F; existing MoleculeShadow (v9) or a TSL contact shadow (v10); Sound Kit felt cues.

**Backend:** DOM/CPU (contact shadow [GPU+GL2] on v10)

**Rides (v10 requirements):** none (R5 for a nicer floor and shadow)

**v9 slice:** The full toy on v9 with baked hulls and the existing MoleculeShadow blob.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/ui/src/play/dice.ts; the atom group in packages/ui/src/app/ViewerScene.tsx; packages/ui/src/MoleculeShadow.tsx; packages/scene/src/AtomPicker.tsx (disabled in the tray); packages/ui/src/sceneRemix.ts (stateless canonical mode from C062).

**Risks:** The whole-molecule motion could be read as molecular motion, so the tray is visibly a separate table and carries a label. Hulls of huge lattices are boxes, which is fine. The model's odds aren't those of real bouncing dice, and the copy says so. Export must exit the tray first. Some may see dice as gambling: there is no money, no currency and no limits.

**Honesty:** "Toy die: tumbles over the hull of this file's atoms; resting odds from a simple solid-angle model. Shape unchanged." Display transform only, reset before any capture, never part of deterministic export.

**Judges:**

- E 4/keep: The outcome is picked first by seeded weights, then animated as a path of rolls over hull edges. It is deterministic, a cheap group transform on v9, and uses real hull rest faces. *Improve:* Put the tray on a visibly separate table with an 'illustrative' label, and keep it out of export.
- P 4/keep: Benzene landing like a coin and a nanotube rolling away like a pencil is personality from real shape, and rolling is compulsively repeatable and feeds Remix. But the outcome is chosen first and the roll is a button, so agency is low. *Improve:* Let a thumb flick throw it, so direction and strength shape the path while the odds stay fixed, and give it a proper roll-and-thock sound set.
- A 3/keep: Rolling on real hull edges to a stable face is delightful, but a felt tray is a skeuomorphic set that is off-brand for a specimen plate. *Improve:* Roll across the Specimen plate's floor with sig-03's Contact shadow.
- Pr 3/park: Delightful, honest hull maths, but rolling the whole molecule across a table is off the inspect-to-share path and feeds only a cosmetic Remix pick. *Improve:* Revisit once Object Facts and Remix are live.
- M 3/keep: Reduced motion is one crossfade to the rest pose plus a thock, but it is whole-object motion on a tray. *Improve:* Add a keyboard Roll, announce the face landed on, and label the tray.

<a id="r2-joy-and-mastery-07"></a>
## Shadow Alphabet: letters hidden in molecules' shadows
`R2-joy-and-mastery-07` · toy · effort M · judges mean **3.2** (E3 P4 A3 Pr3 M3; keep 4, park 1) · self-scored fun 4 / visual 5 · perf costs

> Every molecule hides letters in its shadow. Turn caffeine just so and the shadow on the back wall becomes a crisp K; collect all 26 across the library, then spell short curated words with molecules.

**Framing:** problem->solution

**Builds on:** C090 (reworked from puzzle into discovery)+C094+C088

**Problem:** C090 Shadow Match gave rotation a goal, but as a target puzzle. Pure joy needs surprise. Casual visitors rotate aimlessly, with no reason to explore orientations or other molecules, and the art director wants striking gallery images.

**Solution:**

**Offline bake** (`tools/build-shadow-alphabet.mjs`):
1. Take each gallery molecule of up to 1,200 atoms (the preview cap).
2. Rasterise orthographic silhouettes (the union of projected van der Waals discs) at 64x64 over ~20k orientations: Fibonacci-sphere directions × 24 roll steps.
3. Normalise by bounding box, then compare against 26 uppercase glyph masks in one geometric sans by IoU.
4. Keep the best pose per molecule and letter above a threshold.
5. A content steward accepts only truly readable matches.
The output is `shadow-alphabet.json` of {molecule, letter, quat, iou}. The yield is unknown, so pilot 20 molecules first and publish the real count.
**In the viewer**, a "shadow wall" sits behind or beside the molecule. On v9 it is a DOM SVG silhouette of projected discs updated at 15 Hz only while the pose changes, with a directional light so it matches the ortho bake. On v10 it is a small light-space depth or ID render into a `useRenderTarget` on a wall plane.
Within 12° of a baked pose the wall warms slightly. Within 4° the molecule springs home (quat.slerp with a spring), the letter inks in with a typewriter clack, and it joins your alphabet page in the Notebook.
**Word mode.** Found letters spell words from a curated allow-list (LUPI, ATOM, WOW, HI…), shown as a card of molecules each casting its letter. There is no free text, so nothing needs moderation and nothing is PII.
**Hints and access.** A hint ladder:
1. which molecule still hides a letter
2. a faint compass on the wall
3. a snap
An audio hint raises its pitch as you approach a pose, which gives blind players a route.

**Experience:** Desktop: the wall sits to the side of the molecule, and flicks help. Phone: the wall is a small corner inset outside the thumb zone, and the letter reveal goes full-screen for a moment; Android haptic on snap. Keyboard: Play-scoped hint keys; level 3 includes a "go to pose" route. Screen reader: "The shadow looks like the letter K." Reduced motion: snaps are crossfades. Phone budget: 400 silhouette atoms or fewer on phones (heavy atoms first), recomputed only during rotation, capped at 15 Hz.

**Tech:** Offline Node disc rasteriser and IoU, reusing the parsing and radii in tools/build-gallery-previews.mjs; math quat (fromMat3, slerp, getAngle), spherical; runtime SVG circles sharing one fill (a visual union, no boolean ops); v10 useRenderTarget plus a light-space depth pass. Inspiration: Shadowmatic (https://en.wikipedia.org/wiki/Shadowmatic) and Mitra & Pauly, "Shadow Art" (SIGGRAPH Asia 2009).

**Backend:** DOM/CPU (in-canvas shadow plane [GPU+GL2] on v10)

**Rides (v10 requirements):** none (R6/R9 for the in-canvas shadow via useRenderTarget)

**v9 slice:** All of it: the offline bake plus the SVG shadow wall.

**WebGL2 fallback:** Identical; the v10 wall uses a plain render target, which also works on GL2.

**Where in code:** tools/build-shadow-alphabet.mjs; packages/ui/src/gallery/shadow-alphabet.json; new packages/ui/src/play/ShadowWall.tsx; the Notebook alphabet page.

**Risks:** The letter yield may be thin (Q, W, R), so allow a few larger molecules and be honest about coverage. The bake is ~20k poses × 1,200 discs per molecule, which is minutes offline and acceptable. Readability of pareidolia is subjective, so curation is mandatory. The SVG wall can jank on old phones, hence the atom cap. It's a visual game: the audio hint is only a partial accessibility answer.

**Honesty:** "Pareidolia: a coincidence of this angle, not chemistry." Letters are plainly a game layer drawn as a shadow, never on the atoms. Outside export.

**Judges:**

- E 3/keep: The offline bake (~20k poses × 1,200 discs) is acceptable, and the SVG wall is free at runtime. The letter yield is uncertain. *Improve:* Run the bake before building UI, and ship only if the steward accepts at least ~15 letters.
- P 4/keep: 'Turn caffeine just so and the shadow becomes a K' is a shadow-art surprise, and spelling a friend's name with molecules is a share. The risk is yield. *Improve:* Bake first, and ship only if 20 or more letters are genuinely readable. Make each discovery a secret with a gentle 'warmer' cue.
- A 3/keep: A crisp letter appearing in a molecule's shadow is a magical image when it works, but blobby matches are a letdown, and a second wall panel competes with the specimen. *Improve:* Pilot the letter yield first. Make the wall sig-03's shadow cast onto the backdrop rather than a new panel.
- Pr 3/park: A shareable hook, but the letter yield is unknown, and limiting it to curated words mutes the virality. *Improve:* Run the bake first; revisit as a Daily format if at least 20 letters read cleanly.
- M 3/keep: The offline bake and SVG wall are cheap, but the discovery is purely visual. *Improve:* Announce found letters as text, and never gate progress on it.

<a id="r2-joy-and-mastery-08"></a>
## Desk Mode: a symmetry dial, a spinning top and an Euler's-disk coin
`R2-joy-and-mastery-08` · toy · effort L · judges mean **2.8** (E3 P3 A3 Pr2 M3; keep 3, rework 1, park 1) · self-scored fun 4 / visual 4 · perf neutral

> Prop your phone sideways or leave a desktop tab open and the molecule becomes a desk toy. A ratchet dial clicks exactly as many times per turn as its real rotational symmetry, a top precesses on its real inertia, and flat molecules spin like an Euler's disk whose whirr climbs until it drops.

**Framing:** capability->problem

**Builds on:** C020 (replaces the dream tour)+C055 (calm ticking)+C032 (rigid salvage)+C041 (+ Object Facts, Dice facts)

**Problem:** Idle hands have nothing to do, and the viewer either renders every frame or sits dead. C020's dream tour was criticised as a screensaver nobody asked for and as a vestibular trigger. C055 showed that calmer rendering is possible, but nothing gives fidgeting a molecular reason.

**Solution:**

Desk Mode is entered explicitly from the Play tray. On a phone, turning to landscape while in Play offers it; it never switches automatically. The scene is a dark lacquer desk plane with a contact shadow. **The camera never moves in Desk** (a motion-sickness budget); all motion is the object's own, as a display-only rigid transform. Three fidgets, switched by tabs:
**(1) Dial.** The molecule is mounted on its highest-order axis. A drag turns it 1:1, with a detent every 360°/n where n is that axis's order: water clicks twice per turn, benzene six times, C60 on a C5 five times, and a C1 molecule once. A precision ratchet sound comes from the Look's material table. A DOM "click wheel" strip under the dial advances one detent per direct tap, which gives iOS its real switch haptic. The dial is the fidget.
**(2) Top.** A flick spins the molecule on its lowest hull point. A hand-written heavy-top ODE (RK4 plus accumulator in the physics phase), using Object Facts' moments shifted to the pivot, gives precession and nutation. Symmetric tops spin sweetly, while asymmetric molecules wobble "moodily". It slows and topples onto a stable rest face from the Dice facts, with a felt thock.
**(3) Coin** (planar molecules only: benzene, graphene ribbon). An Euler's-disk toy model: the tilt decays while precession rises on a power law in (t0 − t). The exponent is a tuning constant, because published values vary (Moffatt, Nature 2000, https://www.nature.com/articles/35009017). The whirr's pitch climbs to a sudden stop and the molecule lies flat.
On-screen precession is capped at a quarter of the display rate while the audio keeps climbing, so there is no strobing or wagon-wheel effect.
**Battery.** Render only while something moves. Top and coin always stop within ~20 s; after that, demand frames. The screen sleeps normally. An optional "Keep awake" button requests a Screen Wake Lock on a user tap and releases it on exit or when the page is hidden (https://web.dev/blog/screen-wake-lock-supported-in-all-browsers).

**Experience:** Phone on a stand or in hand: the dial under the thumb, the top and coin as 10-second giggles. Desktop: a side-monitor fidget. Keyboard: left and right step dial clicks; one key flicks the top or coin at fixed energy; Esc exits. Screen reader: "Benzene dial, 6 clicks per turn." Reduced motion: the dial is discrete clicks with stills, and the top and coin become a single still plus the sound. Phone budget: small CPU ODEs, and no rendering once stopped.

**Tech:** Object Facts (axes, moments, rest faces); hand-written RK4 heavy-top and Euler-disk toy models in an accumulator in the scheduler physics phase; math quat/spring/easing; navigator.wakeLock (explicit); Sound Kit; existing MoleculeShadow (v9) or a TSL contact shadow (v10); group transform, reset on exit.

**Backend:** DOM/CPU (contact shadow [GPU+GL2] on v10)

**Rides (v10 requirements):** none (R5 floor and shadow, R7 phases and demand frames)

**v9 slice:** All three fidgets on v9 with the existing shadow blob. Ship the dial first.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/ui/src/play/desk/{dial,top,coin}.ts; the atom group in packages/ui/src/app/ViewerScene.tsx; packages/ui/src/MoleculeShadow.tsx; the scheduler adoption from C002.

**Risks:** Heavy-top and coin tuning takes iteration, and the transitions into toppling must look physical rather than scripted. Picking and labels are off in Desk, and export must exit Desk first. The Euler's-disk model is a toy, and it applies only to flat molecules. Wake Lock drains battery, so it is only ever user-requested.

**Honesty:** "Desk toy: a classical top using this file's mass distribution; the coin follows a simple published scaling. Molecules don't sit on desks. Shape unchanged." Rigid display transform, never in export.

**Judges:**

- E 3/rework: The dial is cheap and grounded in real symmetry. The heavy-top and Euler's-disk models will need a lot of tuning, and a Wake Lock desk toy burns battery by design. *Improve:* Ship the dial only. Add the top and the coin only if dial telemetry justifies them, and avoid a default Wake Lock.
- P 3/keep: A dial that clicks as many times per turn as the real symmetry, and an Euler's-disk whirr, are good fidgets. But it's L effort, and an explicit mode entry hides them. *Improve:* Ship only the dial, from the Play tray, and hold the top and coin until playtest data says they're worth it.
- A 3/keep: Physical fidgets that honour 'the camera never moves' are good, but the lacquer desk is yet another invented set. *Improve:* Use the plate and the Contact floor, and ship the dial first.
- Pr 2/park: Effort L for three fidgets that are orphaned from the product path. *Improve:* Salvage the ratchet dial into symmetry detents.
- M 3/keep: The camera never moves in Desk, precession is capped so there is no strobing or wagon-wheel effect, and Wake Lock is only ever user-requested. But a desk toy renders continuously on a propped phone, which is a thermal and battery cost. *Improve:* Tick the rendering on twos (per-job fps), sleep automatically after N minutes, and take a thermal budget from the device lab.

<a id="r2-joy-and-mastery-09"></a>
## Specimen Sound Kit: ASMR-grade cues derived from the object (C041 deepened)
`R2-joy-and-mastery-09` · system · effort M · judges mean **3.6** (E4 P4 A3 Pr3 M4; keep 5) · self-scored fun 4 / visual 1 · perf neutral

> One tiny procedural sound engine in which every cue comes from the object. The whoosh follows the molecule's real changing silhouette, a 3-fold molecule flutters at three times its spin rate like fan blades, clicks sound like the Look's material, and atoms pan by their 3D position. It is captioned and capped, silent in Inspect, and quiet in Play.

**Framing:** problem->solution

**Builds on:** C041+C093+C003 (+ Object Facts)

**Problem:** C041 defines a vocabulary, but cues that miss the motion make springs feel cheaper (art director). Sound is opt-in, so most players get silence, and iOS haptics fire only on direct DOM taps. Generic ZzFX blips aren't a signature. Today's click synth has no toggle, and the Emoji lab creates an AudioContext per sound.

**Solution:**

**Engine.** One AudioContext and one cue bus. The motion kernel and toys emit typed events:
`grab` · `release(v)` · `coast(ω, axisOrder)` · `detent(kind)` · `lock(n)` · `catch` · `settle` · `pluck(element, pan, depth)` · `roll-edge` · `stamp` · `unlock`
They drive at most 8 voices with priority stealing and per-cue rate limits, through a master compressor and a gentle high shelf. Everything is synthesised; there are no assets.
- **Clicks:** modal synthesis, 2–4 damped sinusoids from the current Look's material table (glass: high and inharmonic; clay: low and short; metal: long and ringing).
- **Air:** filtered noise.
- **Chords:** soft FM bells.
**Geometry-derived parameters (only a real 3D molecule has these):**
- **Whoosh** gain follows the rate of change of the projected hull area (hull vertices from Object Facts, projected per frame) times angular speed. A flat benzene breathes twice per turn like a thrown card; C60 is a smooth hiss.
- **Blade-pass flutter** modulates amplitude at n × rev/s, where n is the rotational order about the current spin axis, as in a fan's blade-pass frequency.
- **Spatial:** StereoPannerNode by screen x, and a low-pass by depth, so atoms at the back sound muffled.
- **Mass:** pluck pitch goes as 1/√mass (the spring analogy) within a pleasant range, and bigger atoms ring longer.
**ASMR direction:**
- close, soft transients with shaped attacks and nothing harsh above ~8 kHz
- low levels, tuned on headphones and phone speakers
- signature textures: felt, paper stamp, typewriter clack, ratchet
**Policy (settles the default debate):**
- Inspect stays silent ("a scientific tool shouldn't make noise").
- Choosing Play or a sound toy turns sound on at low volume, with a visible corner speaker toggle; the choice persists.
- UI cues respect the iOS silent switch (the 'ambient' audio session).
**Captions:** a tiny ink word at each event (click, whoosh, flip!), always available. Only meaningful events (lock, flip, unlock) go to aria-live, rate-limited to one every 2 s.
**Haptics:**
- Android: `navigator.vibrate` at 15 ms or less, 10/s or fewer.
- iOS: only direct taps on DOM chips, via the switch overlay (unverified after 26.5 until a device test), never promised during drags.
- Expo shell: expo-haptics over the WebView bridge.
**Sync:** cues fire from spring events, so sound and motion land on the same beat.

**Experience:** Desktop with headphones: spinning caffeine sounds like a thrown card, and detents feel like a precision dial. Phone speaker: lower gain and fuller mids; with the silent switch on, captions carry everything. Keyboard and screen reader: the same cues, with meaningful ones announced. Phone budget: 8 voices or fewer, and per-frame work is a hull projection of at most a few hundred vertices, only while spinning.

**Tech:** Web Audio (OscillatorNode, BiquadFilterNode, StereoPannerNode, DynamicsCompressorNode, noise AudioBuffer); navigator.audioSession (WebKit only, feature-detected); math/time easing and springs for envelopes; cue bus fed by scheduler jobs; navigator.vibrate; the iOS switch-overlay pattern (ios-haptics style); expo-haptics bridge.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it; it replaces clickSound internals.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/ui/src/sound/ (bus, voices, material tables, captions); retire the per-sound AudioContext pattern in EmojiPlayground.tsx; wire the existing opt-in flag in packages/ui/src/lib/clickSound.ts to the Play policy.

**Risks:** It is taste-dependent and needs a sound designer's pass and speaker tests. The flutter can sound like a helicopter if the depth is too high. Autoplay rules mean the context starts on the first gesture. Annoyance: strict rate limits and a one-tap mute. The iOS haptics claim needs a device check.

**Honesty:** Sounds are illustrative. The single physical mapping is captioned ("pitch ~ 1/√mass, like a weight on a spring; illustrative"). No sound claims to be a spectrum except C073's Pluck.

**Judges:**

- E 4/keep: One synthesised, asset-free cue engine with voice stealing and captions, driven by object facts. It ships on v9 and hosts flagship-08's predicted-time scheduling. *Improve:* Make scheduling at AudioContext time the core rule, and budget a sound designer's pass.
- P 4/keep: Sound is half of game feel, and cues derived from the object (fan-blade flutter by symmetry order, clicks tuned to the Look's material) make it feel authored. It needs a sound designer. *Improve:* Host Cue Sheet's lookahead scheduling and '♪ Hear it' unlock, and give every cue a visual twin for muted iPhones.
- A 3/keep: Sound derived from the object. For motion design, sync matters more than timbre. *Improve:* Host fm-08, and schedule every cue at its analytic spring time.
- Pr 3/keep: The right home for all audio, with cues derived from the object. It needs a sound-design owner. It hosts flagship-08. *Improve:* Adopt 'silent by default, unlocked by a toy', and caption every cue.
- M 4/keep: Host for FM-08. Captioned, synthesised (no asset bytes) and rate-limited, with audioSession handled. *Improve:* Adopt FM-08's silent-until-tapped default. Haptics are never the only channel.

<a id="r2-joy-and-mastery-10"></a>
## Element Temperaments: personality in light and voice, never in physics
`R2-joy-and-mastery-10` · look · effort M · judges mean **2.4** (E3 P3 A2 Pr2 M2; keep 2, rework 1, park 2) · self-scored fun 3 / visual 4 · perf neutral

> Each element gets a temperament from its real numbers (oxygen "electron-greedy, 3.44", gold "heavy and calm", neon "aloof"), shown only through how its atoms answer your touch: a voice, a glint that follows the exact sphere, a one-word etched label and a letterpress card. There is never a squish, a sag or a recolour.

**Framing:** problem->solution

**Builds on:** C083+C093+C050+C094

**Problem:** C083's cards were "a reward rather than a toy" and needed real illustration. The art director penalised squish, tilt sag and party hue-cycling. Element identity leans on colour alone, which is an accessibility gap, and the data reads as a dry table.

**Solution:**

**Temperament table.** Generated from ELEMENT_DATA in packages/core and reviewed by the content steward. Each element gets:
- one headline word plus the number it comes from: mass → heavy/light; electronegativity → electron-greedy/generous; radius → roomy/tiny; category → aloof (noble gases), eager (alkali metals), grabby (halogens), shiny (metals)
- a voice (Sound Kit patch)
- a touch-light style
- a card illustration
**Touch-light styles** live in a 256-entry temperament DataTexture beside the palette textures. On v10 they are TSL `If()` branches in the R3 impostor on uniforms, so nothing recompiles. On v9 they are DOM ring overlays.
- metals: one specular glint sweeps across the sphere, true to the analytic normal
- nonmetals: a soft fresnel glow for 300 ms
- noble gases: no glow; a faint frost ring appears and fades
- halogens: the hover ring (UI, not the atom) leans toward the pointer
- hydrogen: a pin-sparkle at the specular point and a chirp
All respond only to touch or hover. None displaces or recolours an atom, and each stays under 3 Hz and within the flash guard.
**On tap**, an etched label reads "O · electron-greedy · EN 3.44 · 4 in this molecule" (R8 glyph shim; DOM on v9).
**Cards** are C083 redrawn as letterpress in the Illustrate house voice: an ink sphere, the word, three real numbers, and a "light them all" link (C050 highlight). They live on the Notebook's element pages and hold C094's stamps.
**Secret "Roll call":** call one atom of every element in the molecule and each voice sings in turn, forming the molecule's own chord. On the keyboard, the D2 atom cursor steps element by element.

**Experience:** Desktop: hover makes atoms answer and a click shows the label. Phone: a tap answers, since there is no hover. Screen reader: "Oxygen, electron-greedy: electronegativity 3.44; 4 in this molecule." Forced colours: the label and card carry the temperament without light effects. Reduced motion: glints become a static highlight for 1 s. Phone budget: only the touched atom, or one element row, animates; no per-atom CPU work.

**Tech:** ELEMENT_DATA (mass, radius, electronegativity, category); a 256x1 RGBA8 temperament DataTexture; TSL If() on uAnswerAtom/uAnswerT0 uniforms, plus the R2 flag byte for multi-atom roll calls; mood bus (configureTSL + useUniforms); R8 glyph labels; Sound Kit voices; DOM cards on math/time springs.

**Backend:** [GPU+GL2] (v10); DOM/CPU (v9)

**Rides (v10 requirements):** R2 (flag byte), R3 (impostor fragment branch), R8 (etched labels)

**v9 slice:** The temperament table, voices, cards and DOM ring overlays. In-sphere glints wait for R3.

**WebGL2 fallback:** Same: uniform-driven If() branches run on the WebGL2 backend.

**Where in code:** packages/core/src/elements.ts (derive the table); packages/ui/src/AtomInfoHUD.tsx (tap label); packages/ui/src/SelectionMarkers.tsx (v9 rings); the R3 impostor module; the Notebook element pages.

**Risks:** Anthropomorphic words can mislead ("greedy" is a teaching metaphor), so the number and the property name are always shown and the vocabulary is steward-reviewed. At 1M atoms the glints are imperceptible, so only large-on-screen atoms answer (pixel-radius LOD). Card illustration quality decides whether this lands.

**Honesty:** Temperament words are metaphors pinned to the real numbers shown beside them. Touch light is interface, not emission or charge. Colours and positions are never changed. Outside export.

**Judges:**

- E 3/keep: A temperament DataTexture next to the palette, with an If() glint on uniforms, adds no recompiles. The vocabulary needs a steward and a shown number. *Improve:* Ship voices and cards on v9, and glints after R3 only if goldens show they are visible.
- P 3/keep: Personality through voice and light, never squish, is a tasteful way to give elements character. It's subtle for a stranger. *Improve:* Tie each element's voice to the Music Box pads so players hear it in play.
- A 2/rework: Five touch-light styles (a sweeping glint, a fresnel glow, a frost ring, a leaning ring, a pin-sparkle) break the single hover signature and bring sparkle and frost tropes onto the specimen. The anthropomorphic words add to it. *Improve:* Use one hover signature for every atom. Temperament lives only in the card, the voice and the etched label.
- Pr 2/park: Words like 'greedy' are viewer-owned explanatory text, which the contract says needs a named steward and a source basis. Personalities risk cartoonising a specimen for students. *Improve:* Salvage the element voices into the Sound Kit.
- M 2/park: Lens-neutral, and anthropomorphic words need steward review. *Improve:* Revisit after Clear and the Sound Kit ship.

<a id="r2-joy-and-mastery-11"></a>
## Foil Specimens: rare Remix rolls with fair, published odds
`R2-joy-and-mastery-11` · look · effort M · judges mean **3.2** (E3 P3 A4 Pr3 M3; keep 4, park 1) · self-scored fun 4 / visual 4 · perf neutral

> About one Remix roll in 24 comes up Foil (Holo, Gold leaf or Pearl): a clearly cosmetic finish on the rims and the display case, with its own chime and a foil border on the code. The odds are published, rolls are free and unlimited, and every foil can also be earned by a feat.

**Framing:** problem->solution

**Builds on:** C062+C047+C053+C048

**Problem:** The playtester asked for rare rolls to keep C062's rolling compelling. C047 Hologram was nearly killed as a trope that erases element colour, and survives only as a cosmetic rare roll. Rarity mechanics slide easily into gacha dark patterns. Gold-coloured atoms could be read as the element Au.

**Solution:**

**Rarity** is a pure function of the C062 remix code: foil when hash(code) mod 24 == 0, with the kind picked by the next bits. A shared code carries its foil. There is no hidden state, no pity timer, no "rolls since your last foil" counter and no streak. The roll UI prints the odds: "Foil 1 in 24 · each finish 1 in 72."
**Finishes are rim-, specular- and case-only.** Element colour stays the base of every sphere. Each finish has three parts: (a) a view-dependent thin-film rim term in the impostor that shows itself only as you rotate, which is the 3D payoff; (b) the filter-shell case; (c) the code chip's foil border (a CSS conic gradient, static under reduced motion).
- **Holo** (C047 salvage): thin-film rim hue plus a holographic dome sheen. No scanlines, no flicker, no chromatic aberration, no additive shells.
- **Gold leaf:** a gold fresnel rim, gilded bond edges and a warm key light, with CPK cores kept, so it never reads as gold atoms.
- **Pearl** (C053 salvage): an opaque nacre sheen.
If R3 lands on MeshPhysicalNodeMaterial with normal overrides, three's `iridescence` and `sheen` inputs give most of this for free; otherwise a hand-written thin-film Fn (an open question from the looks lens).
**Reveal:** one 900 ms sweep of foil across the molecule from the key-light side (a single sweep, not a flash), a three-note foil chime, and the chip flipping over. A "Foil · cosmetic finish" badge stays on screen and on any card.
**Two roads:** each finish is also unlocked permanently by a feat (Notebook & Feats) and then stays in the Look menu, reachable by keyboard.
**Fairness:** a "Show all finishes" setting unlocks everything for anyone who doesn't want to play.
**Far atoms:** pixel-radius LOD keeps them on the dome sheen only.

**Experience:** Desktop: the Remix button or its key, then rotate to watch the thin film slide across the rims. Phone: tap Remix (a direct tap, so iOS gets its switch haptic), or shake through the shared sensor flow. Screen reader: "Remix r1-K7QD: Pearl finish, cosmetic." Reduced motion: the finish appears in one still with the chime. Phone budget: uniform branches and no extra passes, apart from the dome sheen already paid for by the shell.

**Tech:** C062 codec (FNV-1a plus base32, mulberry32) in packages/core with golden tests; a TSL thin-film Fn, or MeshPhysicalNodeMaterial iridescence/sheen, under If(foilId) in the R3 impostor; mood bus (configureTSL + useUniforms) for the reveal sweep; R5 filter-shell TSL port; CSS conic-gradient chip; Sound Kit chime.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (impostor rim term), R5 (case and filter shell), R6 optional

**v9 slice:** The rarity function, the odds UI, the chip foil and the chime on v9 (DOM), with existing material presets as "preview finishes". The true rim foils arrive with R3; no GLSL is written for them.

**WebGL2 fallback:** Same uniform branches on the WebGL2 backend; no difference.

**Where in code:** packages/ui/src/sceneRemix.ts (stateless canonical mode); a new codec in packages/core; packages/ui/src/StudioControlDeck.tsx (Remix UI); the R3 impostor module; packages/ui/src/MoleculeFilterShell.tsx (R5 port).

**Risks:** A rim-only foil may be too subtle on large scenes, so it needs art-directed goldens per finish. Any rarity can feed compulsion; the mitigations are published odds, no limits, no counters, two roads and a show-all toggle. The thin-film approximation needs a designer's eye so it isn't a generic rainbow.

**Honesty:** "Cosmetic finish. Atom colours and positions unchanged." The badge is shown whenever a finish is active. Finishes are never part of deterministic export or MCP artifacts.

**Judges:**

- E 3/keep: Rarity as a pure function of the code with published odds is clean. A thin-film rim branch under If(foilId) enlarges every impostor variant and needs goldens per finish. *Improve:* Keep foils to rim and case, add them to the warm-start variant list, and apply the flash-budget class to the reveal sweep.
- P 3/keep: A rare foil roll with published odds gives a fair gasp moment, but a rim-only finish risks 'that's it?'. *Improve:* Make the reveal an event (a sweep, a chime, a foil border on the code), and let feats earn foils too.
- A 4/keep: Foils limited to rims, specular and the case, revealed only as you rotate, with element colour intact. That is the correct salvage of holo. *Improve:* Add a golden per finish. Gold leaf changes rig gains only, never panel positions (sig-02).
- Pr 3/park: Published odds and no counters are good hygiene, but rarity mechanics on a student product invite 'gacha' criticism and add nothing to inspection. *Improve:* Revisit once data shows how people use Remix.
- M 3/keep: Published odds and no counters avoid dark patterns, and finishes are rim-only. But view-dependent iridescence during a spin can shimmer. *Improve:* Give foils a 'sparkle' flash class under PE-09, and have Clear ignore foils.

<a id="r2-joy-and-mastery-12"></a>
## Field Notebook and Feats Ledger: ink stamps of your molecule, a secrets meter, spin-to-unlock
`R2-joy-and-mastery-12` · system · effort M · judges mean **3.6** (E3 P4 A4 Pr4 M3; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> A letterpress field notebook in which every verb you discover, secret you find and element you meet is stamped as an ink print of your actual molecule at the exact pose you found it. It has a "secrets found 7 / 31" meter with pull-only hints, a ledger of ~20 physical feats that unlock cosmetic finishes, and a zero-canvas cover on the home page.

**Framing:** problem->solution

**Builds on:** C094+C083+C049+C021 (record)+C062

**Problem:** C094's passport scored 2 from the art director ("a retention mechanic with little visual payoff"). Every judge said toys can't be found. "Spin to unlock" needs rules that aren't grind or FOMO and are reachable by keyboard. The home page can't host a canvas.

**Solution:**

**Pages:**
- Verbs (the D2 grammar: flick, catch, poke, pluck, burst, roll, wind, dial…)
- Secrets (per molecule, with the axis map and alphabet)
- Elements (Temperament cards plus C094 stamps)
- Cabinet (molecules you've handled)
- Feats
- Calendar (Almanac)
**Stamps** are SVG ink prints generated from coordinates at the discovery quaternion. The deterministic projection in tools/build-gallery-previews.mjs moves into a runtime function in packages/core. Molecules over 300 atoms use heavy atoms or the static preview. Drawn in the Illustrate voice: flat ink discs, an outline and a slight letterpress offset. Only {moleculeId, quat as 4×int16, local date, verb} is stored; stamps are re-rendered, never stored as images.
**The secrets meter** counts per molecule and overall. Each secret has a three-step hint ladder (whisper → nudge → exact route, including the keyboard route). Hints are pulled, never pushed.
**The Feats ledger** is ~20 feats, each specified as {id, condition over toy events, keyboard route, hints, unlock}. Examples:
| Feat | Condition | Unlock |
|---|---|---|
| Catch the flip | catch within 300 ms of a tennis-racket flip | flip sound set |
| Trifecta | three clean axis orders within 20 s | Pearl |
| Natural | a die lands on its least likely stable face | Gold leaf |
| Steady hand | a symmetric top spun about its unique axis for 30 s with under 2° wobble | Holo |
| Drone | music box on a planar molecule's normal | drone pad |
| Spin to unlock | per-rotor-class speed marks at 2, 4 and 8 rev/s (Notebook only, never on the canvas) | whoosh variants and an ink colour |
Keyboard players reach speed marks by holding the spin key to wind up.
**Rules:**
- durations are "at least", never countdowns that fail you
- no streaks, no daily limits, no loss
- "Show all finishes" unlocks everything instantly
- Clear, high-contrast and colour-blind looks are never locked
**Unlock moment:** a paper-stamp thump and one card ("Unlocked: Pearl · try it") in 600 ms or less, with no confetti storm.
**The home cover** is a DOM/SVG card with your last three stamps. First-time visitors see a sample page and "start collecting".
**Portability:** localStorage only, with an export/import code (base32) so you can move devices without an account.

**Experience:** Desktop: a key opens the Notebook drawer. Phone: a bottom sheet that rides the sheet (C026) so the molecule stays visible; a stamp flies to the tab in 400 ms or less. Keyboard and screen reader: a navigable grid with text states ("Flip: found on caffeine, 27 Sep") and alt text generated from molecule, verb and pose. Reduced motion: stamps appear without flying. Phone budget: DOM and SVG only, virtualised.

**Tech:** Runtime SVG projection (math mat4/quat/vec3), ported from tools/build-gallery-previews.mjs; Illustrate ink in SVG/CSS; math/time springs; localStorage with try/catch; base32 codec; a feat predicate registry on the play event bus; PII-free analytics (feat id only).

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R6/R8 optional for in-canvas Illustrate prints later)

**v9 slice:** All of it. Finishes that need R3 unlock as v9 preview presets and upgrade automatically.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/core/src/preview/projectSvg.ts (from tools/build-gallery-previews.mjs); new packages/ui/src/play/notebook/* and packages/ui/src/play/feats.ts; home cover in packages/ui/src/landing/ (DOM only, zero-canvas test unchanged); packages/ui/src/analytics/events.ts.

**Risks:** The home cover needs an owner call, even though it is static DOM. Feats can feel like homework, so launch about 20, keep them hidden until hinted, and let playtests prune them. Cost of SVG stamps with many circles is handled by the cap and virtualisation. localStorage can be cleared; export codes are the safety net.

**Honesty:** The Notebook records play, not science. Stamps are labelled ink prints (drawings) of this file's coordinates. Feat names never claim a measurement.

**Judges:**

- E 3/keep: Runtime SVG ink stamps and localStorage make it cheap and v9, and it hosts play-12's meter. SVG cost grows with big molecules. *Improve:* Stamp heavy atoms only above 300 atoms, and share the projector with sig-06.
- P 4/keep: Ink stamps of your own molecule at the exact pose you found a secret make the collection personal. It's the come-back-tomorrow object. *Improve:* Host the Grammar-Is-the-Collection verbs page with a single meter. The home cover card needs the owner call.
- A 4/keep: Ink stamps of your own molecule at the pose you found it are collectibles in the house print voice. *Improve:* Generate the stamps with sig-06's CPU engine.
- Pr 4/keep: One collection surface, with ink stamps of your molecule at the pose where you found each thing. It is localStorage only, so it is lost across devices. It hosts play-12, joy-02 and joy-13. *Improve:* Make it the only meter, and keep the home cover card behind an owner call.
- M 3/merge: Merge into PE-12. The notebook overlaps the secrets meter, and feats risk rewarding dexterity. *Improve:* No speed- or timing-gated feats.

<a id="r2-joy-and-mastery-13"></a>
## The Secret Pack: secrets are states, not gestures
`R2-joy-and-mastery-13` · system · effort M · judges mean **3.4** (E3 P4 A3 Pr3 M4; keep 4, merge 1) · self-scored fun 4 / visual 3 · perf neutral

> Thirty molecule-specific secrets that you trigger with the verbs you already know: look through a ring, find the empty centre of a cage, see a flat molecule vanish edge-on, call every element. Secrets never fight the gesture grammar, and every one is reachable by keyboard.

**Framing:** problem->solution

**Builds on:** C094+C021+C076+C091 (+ Object Facts and the toys in this set)

**Problem:** "Secret gestures" would collide with a gesture map in which tap, double-tap and long-press are each already claimed by 3–10 ideas. Hidden gestures are inaccessible by definition. Easter eggs that aren't about the molecule are just a game skin.

**Solution:**

**Rule:** a secret is a detectable state or sequence built from standard verbs (orbit or flick, tap, catch, pinch, keys), computed from Object Facts. Every secret has:
- a keyboard route
- screen-reader text
- a reduced-motion still
- a three-step hint
- a single predicate evaluated at most 10 Hz, only while the viewer is awake (a per-job `fps: 10` scheduler job), so there is no idle cost
**Launch pack examples:**
1. **Ring window:** align the view with a ring normal (benzene, caffeine's rings) and tap the empty ring centre. The ring's atoms sound in order around it.
2. **Hollow:** zoom inside C60 or the nanotube (camera inside the hull, tested against hull face planes). The Sound Kit muffles and the stamp reads "Inside the cage".
3. **Centre of nothing:** tap the centre of mass where it lies in empty space (C60, benzene). A tiny ink crosshair appears with a soft hollow tick.
4. **Flatland:** view a planar molecule exactly edge-on (planarity RMS from Object Facts) until it collapses to a line, with a paper sound.
5. **Nothing repeats:** on a C1 molecule, try detents from all three principal axes.
6. **Flip** (True Spin).
7. **Drone** (Music Box).
8. **Teeter** (Dice).
9. **Letter** (Shadow Alphabet).
10. **Roll call** (Temperaments).
11. **Every atom:** tap each atom of a molecule of 30 atoms or fewer once, and the full chord plays. It works with the D2 atom cursor, so screen-reader users can do it.
12. **Long look:** hold still on C60's 5-fold view for 10 s and the rosette inks in slowly. A patience secret with no motion at all.
13. **Heavyweight:** tap the heaviest element first.
14. **Mirror** (with C076): on a chiral molecule (limonene, menthol), open its mirror twin.
**Distribution.** About 2–4 secrets per molecule, curated to ~30 at launch, from pools that exclude psychoactive gallery entries. The meter tells you "3 secrets here", so people know to look.
**Taps on empty space** need a ray test against ring-centre discs and the CoM point. This is hand-written, because math has no ray-sphere or ray-disc test. On v10, GPU ID picking (C009) plus a depth read resolves taps on atoms precisely.

**Experience:** Desktop and phone: secrets fire during ordinary play, and each reveal lasts 1.5 s or less. The keyboard route sits at hint level 3, which prevents spoilers. Screen reader: every reveal is spoken as the fact it rests on ("Benzene is flat to within 0.01 Å in this file"). Reduced motion: reveals are stills. Phone budget: one 10 Hz predicate pass while awake, doing angle and distance tests on a handful of vectors.

**Tech:** Object Facts (rings, CoM, hull planes, axes, planarity); math quat.getAngle, vec3, plane-distance tests; hand-written ray-disc and ray-point tests; @pmndrs/scheduler 0.2.0 per-job fps 10; C009 GPU ID pick on v10; Sound Kit; Notebook.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R6 GPU picking improves phone tap accuracy)

**v9 slice:** All of it, with the tap-only AtomPicker on v9.

**WebGL2 fallback:** Identical.

**Where in code:** New packages/ui/src/play/secrets.ts (registry and predicates); hooks in packages/ui/src/app/CameraManager.tsx and packages/scene/src/AtomPicker.tsx; the Notebook.

**Risks:** Too many secrets become noise, so curate and playtest. Accidental triggers (Flatland) are fine, because they read as delight. Every predicate must be off during measurement. Content upkeep is small, since secrets derive from facts rather than hand-placed content.

**Honesty:** Each reveal states the real fact it rests on, with a tolerance where relevant. Interface marks (crosshair, rosette) are ink UI, not data. Camera and UI only, outside export.

**Judges:**

- E 3/keep: Secrets as detectable states built from standard verbs never fight the grammar. Predicates run in a 10 Hz scheduler job only while awake, so there is no idle cost. *Improve:* Curate about 15 at launch and switch predicates off during measurement.
- P 4/keep: Secrets as states reached with verbs you already know (look through a ring, Flatland edge-on) never fight the grammar and reward curiosity. This is the content that makes the Handling Loop work. *Improve:* Launch 12 secrets, one per curated molecule, not 30, and measure accidental-discovery rates in playtests.
- A 3/keep: Secrets defined as states (look through a ring, watch a flat molecule vanish edge-on) reward composition. *Improve:* The response to a found secret is the detent or mandala click, not a new effect.
- Pr 3/merge: Merge into R2-joy-and-mastery-12. 'Secrets are states, not gestures' is the right rule because it avoids gesture conflicts. *Improve:* Make it the Notebook's Secrets page.
- M 4/keep: Every secret has a keyboard route, screen-reader text, a reduced-motion still and a hint, and predicates run at 10 Hz only while awake. *Improve:* Share the meter with PE-12, and exclude any secret that needs fast or precise motion.

<a id="r2-joy-and-mastery-14"></a>
## Almanac: daily dares and seasonal twists, never streaks
`R2-joy-and-mastery-14` · system · effort S · judges mean **2.8** (E3 P3 A2 Pr3 M3; keep 4, merge 1) · self-scored fun 3 / visual 2 · perf neutral

> A date-seeded almanac adds one small dare to an existing toy each day ("find all six 2-fold axes of benzene", "wind water's music box in Dorian"), plus a few yearly twists tied to real chemistry dates such as Mole Day and Pi Day. Every past dare can be replayed, and nothing counts streaks.

**Framing:** problem->solution

**Builds on:** C088+C089+C090+C043+C044

**Problem:** C088's Daily is the only come-back loop, and its season is short (~72 guessable previews). Daily and seasonal twists on existing toys were requested, while streak shaming and FOMO are ruled out. Hand-written daily content doesn't scale.

**Solution:**

**Daily dare.** `mulberry32(dateSeed)` picks a template, a molecule from the curated pool (no psychoactive entries) and a parameter. A dare is emitted only if Object Facts prove it achievable: the axis exists, the face exists, the molecule is planar for a drone. Templates:
- land axis order k
- roll face X
- play the music box on axis Y in mode Z
- find letter L
- spin a symmetric top for 20 s
- call every element
It appears on a zero-canvas DOM card on home and as a chip in the viewer. Completion stamps the Notebook's calendar. Missed days are blank, never red, never counted. "Play any past dare" opens the archive up to today.
**Daily flavour:** the Music Box scale of the day and the stamp ink colour of the day.
**Seasonal twists** come from a small content-steward calendar. Each returns every year and can be previewed in the archive, so nothing is exclusive:
- **Mole Day** (23 Oct): the Music Box at 60.2 bpm, tallies in moles ("you've tapped 5.0 × 10⁻²³ mol of atoms"), and a stamp.
- **Pi Day** (14 Mar): a dare to spin benzene at 3.14 rev/s, and a π watermark on stamps.
- **Solstices and equinoxes:** C044's Light Painter key light at a seasonal sun elevation, using the date only and never location.
- **Winter:** the C043 snow option on the dome (sprites on both backends; flakes pile on upward-facing atoms only on WebGPU).
- **Other dates** (Periodic Table Day, Mendeleev's birthday): only after the content steward confirms them.
**Share text:** "Lupi dare 27 Sep ✓", spoiler-free with no pose.

**Experience:** Home: a DOM card reading "Today's dare: find benzene's six 2-fold axes" with a play link and no canvas. Viewer: a dare chip plus the relevant toy armed. Keyboard and screen reader: fully described text dares. Reduced motion: dares that need motion accept the reduced-motion route (for example, the seek-axis key). Phone budget: nothing continuous; a date hash and a table lookup.

**Tech:** math mulberry32.create/next on an integer date seed (integer-exact across browsers); a dare template table validated against Object Facts; localStorage; DOM; Sound Kit scale tables. No server.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it.

**WebGL2 fallback:** Identical (snow piling stays [GPU]-only, with sprites elsewhere, as in C043).

**Where in code:** New packages/ui/src/play/almanac.ts; the home card in packages/ui/src/landing/ (DOM only); the Notebook calendar page.

**Risks:** Seasonal content needs a small yearly review. Time zones are handled by using the local date, and the archive covers any disagreement. Template variety could feel repetitive by month three, so add templates as new toys ship.

**Honesty:** Dares are play. Seasonal facts are real and cited (Avogadro constant 6.022 × 10²³ mol⁻¹). Seasonal visuals (snow) are labelled decorative. Outside export.

**Judges:**

- E 3/keep: Date-seeded integer PRNG dares validated against Object Facts. Small, DOM-only, no server, no streaks. *Improve:* Fold it into C088's Daily surface rather than a separate card.
- P 3/keep: Date-seeded dares with no streaks give a light reason to come back, but they depend on the toys existing. *Improve:* Launch it after the Notebook, with 20 templates, tied to the Daily card.
- A 2/keep: Outside my lens. *Improve:* Seasonal twists stay within the four Looks and never add a Look.
- Pr 3/merge: Merge into R2-capture-share-loops-10. Date-seeded dares without streaks overlap the Daily. *Improve:* Make it a rotating C088 format.
- M 3/keep: No streaks, an archive and DOM only. *Improve:* Dares are never timed, and the home card stays static.

<a id="r2-joy-and-mastery-15"></a>
## Feat Cards and Dare Links: brag without spoilers or PII
`R2-joy-and-mastery-15` · share-loop · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 3, merge 2) · self-scored fun 3 / visual 3 · perf neutral

> Any feat, secret or record becomes a card and a link that says what you did, not where it was ("Caught a tennis-racket flip on a 24-atom molecule"). A spoiler guard protects the Daily and secret poses, and the link drops a friend into the same toy to try it.

**Framing:** problem->solution

**Builds on:** C106+C103+C105+C088

**Problem:** Brag moments must be spoiler-free (secrets, the Daily) and PII-free (no names, free text or location). C106's cards and C103's loops are generic. Instant Replay (the last ~6 s re-rendered) is only a spark.

**Solution:**

**Cards** use Illustrate ink templates. On v9 they are Satori/resvg cards at the edge from ids, like C106; after R9, client captures. The feat is written from a fixed phrase table. The molecule appears as a normal ink print, unless the feat is a secret or today's Daily, in which case it shows only an abstract hull silhouette. A Foil badge appears if a finish was active, with an "illustrative play" footer and alt text generated from the phrases.
**Dare link:** `/?dare=<featId>.<moleculeId>.<code>` opens the molecule with the feat's toy armed and hint level 1: "A friend caught a flip here. Can you?" It carries only ids and integers: no user text, no scores compared on a server, no leaderboard.
**Instant Replay** (after R9) keeps a ring buffer of the last ~6 s of camera pose and toy state (a few hundred small records). It is re-rendered frame-exact into a 3 s loop through D4's capture service. Secret poses are cropped or abstracted.
**Output:** Web Share or the clipboard. The Worker's share HTML unfurls it with the card as og:image instead of the static og-lupi.png.
**Analytics:** `share_feat` with the feat id only.

**Experience:** After an unlock, a "Share this feat" chip appears (a direct tap, so iOS gets its switch haptic). Desktop: copy the link. The friend opens the link on any device and the toy is ready. Screen reader: the card's alt text is the feat sentence. Reduced motion: a still card instead of the loop. Phone budget: nothing until share; card generation happens at the edge.

**Tech:** Satori/resvg on the edge Worker (the existing share HTML path); a URL codec in packages/core; D4 capture service (useRenderTarget + readRenderTargetPixelsAsync, Mediabunny/WebCodecs, MediaRecorder fallback) for the replay; Web Share API / ClipboardItem.

**Backend:** DOM/CPU (replay [GPU+GL2] after R9)

**Rides (v10 requirements):** R9 for Instant Replay; none for cards and links

**v9 slice:** Edge cards and dare links on v9.

**WebGL2 fallback:** Identical for cards. The replay uses render-target readback, which works on both backends; VideoFrame from a WebGPU canvas on Safari is avoided.

**Where in code:** apps/mcp-worker/src/index.ts (DEFAULT_SOCIAL_IMAGE at ~202; the share HTML path); dare URL parsing next to the existing query routing in apps/web/src/main.tsx; new packages/ui/src/play/share.ts.

**Risks:** resvg-wasm bundle size and cost at the edge. Every new URL route needs a steward review. The spoiler guard must be tested against the Daily. Any replay touching secret poses must abstract them.

**Honesty:** Cards and loops are labelled "illustrative play", are never MCP artifacts, and never present a feat as a scientific result.

**Judges:**

- E 3/merge: Merge into R2-capture-share-loops-05. Feat cards reuse the same edge-card path; dare links belong in capture-07's grammar. *Improve:* Add a phrase table and a spoiler guard to capture-05's templates.
- P 3/keep: 'Caught a tennis-racket flip' as a spoiler-free brag card is a good social hook, but it overlaps Instant Replay. *Improve:* Make dare links drop the friend into the same toy with the same seed, on capture-03's infrastructure.
- A 3/keep: Spoiler-guarded abstract hull silhouettes are a nice device. *Improve:* Take the templates from cap-02.
- Pr 3/merge: Merge into R2-capture-share-loops-02. Brag cards that don't spoil or reveal PII are just templates plus link grammar. *Improve:* Add a Feat template and a dare link.
- M 3/keep: Spoiler-free cards with alt text. *Improve:* Make them text-first like CS-10.
