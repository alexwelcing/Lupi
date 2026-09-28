# Round 2 · Every Toy Has a Real Twin

[← all round-2 ideas](README.md)

## Direction notes

DIRECTION: Every Toy Has a Real Twin. It is built as three things: (a) a system (the Evidence Ladder and Twin Door), (b) a data foundation (lupi-provenance/1 and its eligibility gate), and (c) twins and answer toys that make the real thing the reward.

REPO AUDIT FINDINGS that change round 1's assumptions:
(1) sand_w_cascade is not a run. apps/web/public/archive/w_cascade_150keV.lammpstrj has one TIMESTEP: 31,250 W atoms on near-ideal bcc sites with a painted damage column, labelled 'representative recreation'. The burst's twin is therefore a new cu-cascade bake. LAMMPS pair_style zbl is core, per the LAMMPS docs.
(2) scripts/generate_timeseries_animations.py fabricates 'shockwave / shear / diffusion' motion with random jitter from single frames. Its outputs must be tagged kind: recreation, or the script retired, so that nothing it makes can ever become a twin.
(3) gallery-nomenclature.json already has a confidence vocabulary (source-backed / computed / procedural / illustrative), but it covers only 64 molecules. None of the four carbon structures, the Cu runs or the recreations are classified. C60's 'DFT Optimized' geometry has no recorded source.
(4) The published cu-melt manifest (lupi-sim-manifest/1) makes an exact thermostat set-point per frame possible: 300 + 16.3 K per frame over frames 0-85, then a 1,700 K hold, with the potential's ~1,340 K melting point between frames 63 and 64. The runs are large: cu_melt 45.3 MB, cu_solidify 33.8 MB, cu_sinter 57.6 MB. So doors disclose bytes, and demo sizes must be published before a phone launch.
(5) The 12 curated molecules are water, ethanol, acetone, benzene, caffeine, aspirin, phenol, glucose, diamond_crystal, graphene_ribbon, c60_buckyball and cnt_6_6. Their steward note says prompts ask for observations, not properties. Every answer-card number is computed from the committed XYZ files:
- water: H-O-H 103.98° in the file
- benzene and phenol: 0.00 Å from one plane; the phenol and benzene rings are identical ideal 1.395 Å hexagons
- acetone: angles 121.6° / 121.6° / 116.7°
- glucose: ring puckered by 0.26 Å, 1 O in the ring and 5 outside
- aspirin: flat ring, with an O 2.34 Å out of its plane
- caffeine: two N in each ring
- diamond: 4x4x4 cells, 8 atoms per cell, 1.54 Å neighbours
- C60: 12 pentagons and 20 hexagons
- tube: radius 4.068 Å, repeat 9.838 Å
- ribbon: periodic along z, with H-capped edges

KEY DECISIONS:
- Units are earned by data. Pretend controls never show K, cm^-1 or Å, which removes C033's kelvin problem in one enforceable rule.
- Fixed a physics error in C033: for a classical harmonic bond, mean-square displacement is kT/kappa, independent of mass. The pretend jiggle therefore scales rate, not amplitude, with 1/sqrt(m).
- Found a zero-GLSL v9 path for real normal modes. A mode is linear, so base +/- A*m on the existing uProgress hook plays it exactly (bonds included). The Mode Harp ships before the port. Caveat: buffers must be restored before V1 export.
- Water's toy answers its prompt ('straight or bent?') with the Bend Dare. Sticky water moves to stage 2 of the staged journey, because tugging hydrogen bonds does not answer the water prompt D5 assigned it to.
- The X-ray box became the 'Always-Eight Cell', a true invariant with a goal, answering the playtester's 'feature with handles' critique.
- C074 drops openchemlib and MMFF entirely: Lupi looks shapes up rather than computing them.
- C077's choreography goes through an element-sorted tray, so it cannot pass as mechanism. Its real twin is the isotope-tracer literature: Roberts & Urey 1938, and Ruben et al. 1941, which also yields the 12 H2O photosynthesis equation.
- Twins that are a different subject (caffeine heat -> copper melt) say so in words.

TENSIONS RESOLVED:
- Homework versus reward: doors appear only after play, at the climax; twins carry their own goals (guess, find, scrub to the tick); passport stamps.
- The art director's continuous dive versus the vestibular and precision risk: stages plus a FLIP into a DOM ruler.
- Speedrun: the steward said drop it, the playtester said keep it. It survives as an opt-in-timer Rebuild launched from the burst.

LEFT OUT DELIBERATELY:
- live MD and in-browser quantum chemistry (C079, C086)
- electron-density-like visuals (C059)
- chirality (C076) and VSEPR (C075)
- new arcade games
- computed modes for the periodic tube, ribbon and diamond (withheld rather than faked from cut-open cells)
- the name in growth URLs (only the hash travels)

OWNER CALLS NEEDED:
- the sound default
- home-card motion for Real or Pretend (posters by default)
- whether measured property values may appear on the curated molecules' twin cards
- steward bandwidth for bakes (cu-cascade, cutout-anneal and seeded growth each need MD expertise)

No FPS claims are made; the budgets are atom counts, bytes and job policies. Unverified items are marked: transition() on GL2, iOS switch haptics, fix dt/reset and dump_modify every/time in the wheel's build, the glimbin per-atom property path, and CNT modes.

SOURCES:
- Roberts & Urey 1938: https://pubs.acs.org/doi/abs/10.1021/ja01277a028
- Ruben, Randall, Kamen & Hyde 1941: https://pubs.acs.org/doi/10.1021/ja01848a512
- CCCBDB water geometry: https://cccbdb.nist.gov/expgeom2x.asp?casno=7732185
- LAMMPS pair_style zbl: https://docs.lammps.org/pair_zbl.html
- RBM 248/d relation: https://pmc.ncbi.nlm.nih.gov/articles/PMC3212007/
- PubChem3D conformer generation: https://jcheminf.biomedcentral.com/articles/10.1186/1758-2946-3-4

KEY REPO FILES:
- /home/user/Lupi/packages/ui/src/gallery/studentCollection.ts
- /home/user/Lupi/packages/ui/src/StudyLensPanel.tsx
- /home/user/Lupi/packages/ui/src/galleryNomenclature.ts
- /home/user/Lupi/tools/sims/make_phase_trajectories.py
- /home/user/Lupi/scripts/generate_timeseries_animations.py
- /home/user/Lupi/apps/web/public/archive/w_cascade_150keV.lammpstrj
- /home/user/Lupi/packages/ui/src/molecules/pubchemLoad.ts

<a id="r2-real-twins-science-01"></a>
## The Evidence Ladder and the Twin Door
`R2-real-twins-science-01` · system · effort M · judges mean **3.6** (E3 P3 A3 Pr5 M4; champion 1, keep 4) · self-scored fun 3 / visual 3 · perf neutral

> Every toy that moves atoms or shows a number names its rung in words (Pretend, Derived, Simulated/Computed, Measured), earns physical units only from data, and opens a Twin Door at its climax that match-cuts into its real counterpart as a reward.

**Framing:** problem->solution

**Builds on:** C027+C030+C033+C072+C073+C080+C094 (round-1 lesson 4, made concrete)

**Problem:** Round 1 agreed on 'a real counterpart one tap away' but never said when it appears, what it says, or how it avoids feeling like homework. Today the only honesty text for motion is a code comment ('Display-only inertia. Source atoms never move.' in gpu-studio/snow-motion.ts). The Learn panel's provenance block has three lines (coordinates, bonds, properties) and none for motion. Round-1 pitches blurred the rungs: C033 attached kelvin and 'real thermal amplitudes' to invented jitter, and C118's arcs implied transformations. Without shared words, 30 toys will each invent a badge, and agents reading lupi.viewer_state cannot tell pretend motion from data.

**Solution:**

FOUR RUNGS, always in words, and each readout opens with its rung.
(1) Pretend: 'Pretend motion (illustrative)'. Toy displacement, never data.
(2) Derived: 'Measured from this file'. Exact geometry computed from the displayed coordinates: hulls, plane fits, counts, neighbour shapes.
(3) Simulated/Computed: 'Simulated: LAMMPS, EAM Cu_u3' or 'Computed: GFN2-xTB normal mode'. An offline run that has a manifest.
(4) Measured: 'Measured in the lab: NIST CCCBDB (Hoy & Bunker 1979)'. A cited experiment.
The ladder maps onto the confidence vocabulary already in galleryNomenclature.ts (source-backed / computed / procedural / illustrative). Learn also says plainly that PubChem 3D geometry is a computed model (PubChem3D uses OMEGA with MMFF94s), not a measurement.

RULES.
(a) Units are earned by data. A Pretend control never shows K, cm^-1, eV or Å; its slider reads calm / lively / wild. Enforced in code: the registry's PretendControl type has no unit field, and a unit test fails if a pretend toy's aria-valuetext contains a unit token.
(b) Which toys need a twin. Anything that displaces atoms that look like source atoms, or that shows a quantity. Camera toys (flick, detents) and Looks need none; the temperature colour map is the one exception.
(c) Door timing. Never before the toy has been played. It appears at the toy's climax or settle (scheduler onIdle after the toy's settle) as one chip with a single pulse and no loop. The chip carries a hook line ('Real is weirder: ...') and the byte size of what it will load. One door per toy per session.
(d) Match-cut. The toy's last display state becomes the twin's entrance 'from' state, on the C030 condense tokens. Examples: the burst cloud condenses into the cascade's frame 0; the ember tint dissolves into the thermometer's temperature colour map.
(e) Mismatch disclosure. If the twin is a different subject, the door says so: 'We have no simulation of caffeine heating. Copper is the closest real run we publish.'
(f) Reward loop. The first meeting stamps the C094 passport ('Twin met: copper melt'). Twins carry their own small goals (guess, find, scrub to the tick), so they are toys too, just honest ones.
(g) Learn gets a live fourth provenance line, Motion. Examples: 'None: you are seeing the file's coordinates.' / 'Pretend (illustrative): heat jiggle; the file's positions are unchanged.' / 'Simulated: frame 64 of 101, LAMMPS cu-melt, thermostat set-point 1,345 K.'
(h) MCP. lupi.viewer_state gains play {activeToy, rung, illustrative, twinId}.

TWIN MAP v1.
- heat -> cu_melt thermometer, plus cu_solidify in reverse
- burst -> a newly baked cu-cascade run, NOT sand_w_cascade (a one-frame recreation)
- poke -> Mode Harp
- knife -> lattice-plane section, and a flatness fit for molecules
- growth -> the real lattice file, plus cu-seeded-growth
- cutter -> cu_sinter, plus an anneal bake
- build -> the PubChem or gallery conformer
- recycler -> isotope-tracer experiments
- unroll -> graphene ribbon, plus the measured radial breathing mode (RBM) relation
- tug / sticky water -> hydrogen-bond criterion, plus measured boiling points

**Experience:**

Desktop: after the burst settles, a chip slides up beside the 'Pretend motion (illustrative)' chip: 'Real is weirder: in metal, not every atom comes home. See a real run (6 MB)'. Click it or press T; Escape returns to the toy with its state restored.

Phone: the same chip sits in the thumb zone as a real DOM button, so it can fire the iOS switch haptic (unverified claim, needs a device test). Swipe it away to dismiss.

Screen reader: one polite announcement, 'A real version is available: copper cascade simulation, 6 megabytes'. Every readout starts with its rung.

Reduced motion: the match-cut becomes a crossfade between two stills.

Budget: a DOM chip only. Twins load only on tap, never prefetched, and Save-Data asks first with the byte count.

**Tech:**

- C027 deformer registry gains {rung, twinId, settle, still}.
- @pmndrs/scheduler 0.2.0: onIdle and per-job fps (also works on v9).
- math/time spring.update for the chip entrance (analytic, stable at any dt).
- R6 useRenderPipeline transition() (three r186) for the match-cut. GL2 behaviour is UNVERIFIED node by node; the v10 hooks are canary 14007b4, alpha.
- v9 fallback: CSS crossfade over a captured still (v9 has preserveDrawingBuffer: true).
- aria-live region.
- localStorage for 'twins met', wrapped in try/catch.

**Backend:** mixed (DOM/CPU chip, Learn row and viewer_state; [GPU+GL2] match-cut)

**Rides (v10 requirements):** R3 (C027 registry), R6 (transition), R7 (onIdle/demand)

**v9 slice:**

Ship on v9:
- the vocabulary and the unit rule with its test
- the Learn Motion row and the viewer_state play block
- the twin map, with DOM doors from content that already exists (gallery cards to the C072 thermometer)
- CSS crossfades
No GLSL.

**WebGL2 fallback:** Same logic. If transition() misbehaves on the WebGL2 backend, crossfade over a still captured with readRenderTargetPixelsAsync (which works on both backends). Low Power Mode changes nothing: the chip is DOM.

**Where in code:**

- packages/ui/src/StudyLensPanel.tsx and packages/ui/src/studyFacts.ts (buildDataProvenance gains motion)
- packages/ui/src/galleryNomenclature.ts (map the confidence classes to rungs)
- new packages/ui/src/play/registry.ts (C027)
- packages/ui/src/mcpViewerBridge.tsx (viewer_state)
- packages/ui/src/gpu-studio/snow-motion.ts (its honesty comment becomes a visible label)

**Risks:**

- Door fatigue: capped at one door per toy per session.
- Preachiness: the hook line leads with wonder and the rung comes second.
- Derived versus Measured may confuse strangers: test in the D2 playtest protocol.
- The existing 'source-backed' class for PubChem conformers hides that the geometry is computed: Learn must say so.

**Honesty:** Makes the contract visible in words and enforceable in code (unit rule, registry type, viewer_state). It walks back round 1's over-claims and never upgrades pretend motion. Everything stays outside deterministic export: C027 zeroes offsets, and chips and doors are DOM.

**Judges:**

- E 3/keep: Rungs in words, with units earned only from data, turn the honesty contract into UI. The DOM doors ship on v9; the match-cut needs R6 transition(), with a still-crossfade fallback. Door fatigue and preachiness are the risks. *Improve:* Put the rung and twinId in the ToyManifest, and cap doors at one per toy per session.
- P 3/keep: A Twin Door at the climax that match-cuts into the real thing can feel like unlocking a secret level, and the rung words keep it honest. Risks: preachiness and door fatigue. *Improve:* Show the door only as a reward after play, never before it, and test in Couch Test whether strangers actually take it.
- A 3/keep: The match-cut Twin Door is good motion design, but a four-rung chip adds more chrome to the canvas. *Improve:* Carry the rung wording in sig-05 labels and the Play chip, not a new chip.
- Pr 5/champion: It turns the contract's 'distinguish supplied structure from inferred convenience' into four words and makes the Twin Door a reward. That is the sharpest differentiation from PhET, which has sims without real data, and Mol*, which has data without play. Risks: door fatigue and a preachy tone. *Improve:* Ship the vocabulary, the unit rule and the Learn Motion row on v9 first. Get steward sign-off on the rung words. Allow at most one door per toy per session.
- M 4/keep: Rungs spoken in words (not badges) serve screen-reader users and everyone else. Units come only from data, and there is one door per toy per session. *Improve:* Under reduced motion the Twin Door match-cut becomes a crossfade, and the rung text leads every aria-live readout.

<a id="r2-real-twins-science-02"></a>
## Science Shelf: lupi-provenance/1, a Named Publisher and a Twin Eligibility Gate
`R2-real-twins-science-02` · foundation · effort M · judges mean **3.2** (E4 P2 A2 Pr5 M3; keep 5) · self-scored fun 1 / visual 2 · perf neutral

> Generalize the existing lupi-sim-manifest/1 into one manifest for every baked artifact (runs, normal modes, reaction maps, cuts, growth runs). A named steward publishes through CI, Learn renders it in plain words, and it decides which assets may ever be offered as a real twin.

**Framing:** problem->solution

**Builds on:** C073+C077+C080+C040+C078 (their provenance conditions) + the existing lupi-sim-manifest/1 and galleryNomenclature.v1

**Problem:**

Twins are only as honest as their data. A repo audit shows the gaps.
(1) sand_w_cascade, round 1's twin for the burst, is ONE frame: a 'representative recreation' of 31,250 W atoms on near-ideal bcc sites with a painted damage column (7,225 atoms nonzero). It is not a run.
(2) scripts/generate_timeseries_animations.py fabricates multi-frame 'shockwave / shear / diffusion / lattice_snap' motion with random jitter from single frames, targeting w_cascade, the HEA dislocation, LLZO and GST files. Its output would look exactly like MD.
(3) gallery-nomenclature.json classifies 64 molecules but none of the four curated carbon structures, the Cu runs or the recreations.
(4) c60_buckyball's metadata says 'DFT Optimized' with no code, functional or reference.
(5) C073's modes, C080's collisions and C077's mappings would make Lupi a publisher of computed results with no owner or review.
Only the LAMMPS phase-change runs have real provenance today: lupi-sim-manifest/1 sidecars on GCS (cu-melt: potential, protocol, seed 4928459, LAMMPS 20260330, glimbin 45.3 MB).

**Solution:**

ONE SCHEMA, lupi-provenance/1. It is a superset of lupi-sim-manifest/1, and old manifests validate through an adapter. Required fields:
- id@version
- kind: sim | modes | tracer-map | ledger-map | derived | model | conformer | analysis | recreation
- rung: simulated | computed | measured | derived | illustrative
- subject {galleryId, sourceSha256, atoms}
- method {engine, version, level or potential, parameters, seed}
- geometry {computedAt, rmsdToDisplayed_A}. Modes computed at an xtb-optimized geometry but shown on the PubChem geometry must state the RMSD.
- scaling {frequency: 1.0 unless a published factor is adopted, with its reference; displayAmplitude: 'shown as xN in UI'}
- outputs [{path, sha256, bytes}]
- verification {expect: kind-specific}
- citations [{doi|url, what}]
- steward and reviewedBy
- license: ODbL-1.0 for first-party data per LICENSE-DATA.md; upstream licences kept
- reproduce (the exact command) and generatedAt

PUBLISHER. A named Science Steward, the same role STUDENT_COLLECTION already names ('Steward: Lupi product owner'), with a second reviewer for any new kind. A PR adds the bake script output plus its manifest. Small outputs (up to about 1 MB: modes, maps, lattice descriptors) live in apps/web/public/science/<id>/. Large runs go to the existing GCS sims bucket beside their manifest, as tools/sims/README already prescribes.

CI GATE: tools/verify-provenance.mjs, a sibling of audit-gallery-claims.mjs.
- Hashes must match.
- Kind checks:
  - modes: 3N-6 (3N-5 if linear), mass-weighted orthonormality within tolerance, imaginary frequencies flagged
  - sim: dump contract, frame count, min_moved_fraction
  - ledger/tracer: per-element conservation, and a citation for every tracer
  - derived: every atom sits on a site of the declared lattice
  - conformer: formula matches the PubChem CID
- Twin registry entries must point at a manifest with rung other than illustrative and kind other than recreation. No manifest, no twin.

RECREATIONS keep their gallery cards, but the word 'recreation' becomes visible on the card and in Learn. generate_timeseries_animations.py is retired, or writes kind: recreation.

LEARN renders a 'How this was made' card from the manifest:
- one plain sentence ('A computer simulation of 26,400 copper atoms heated from 300 K to 1,700 K over 140 ps')
- what is real and what is not
- the method line and citations
- a copyable reproduce command

MCP: viewer_state exposes the active manifest id, so agents can cite it.

**Experience:**

Visitors see trust rather than tooling: the 'How this was made' card, the rung line on every readout, and the byte size on every door.

Desktop and phone: the card lives in Learn's existing 'What this model tells you' details element, which is plain, keyboard-reachable text.

Screen reader: the one-sentence summary is read first.

Contributors: one bake command per kind, and a red CI check when provenance is missing.

**Tech:**

- A JSON Schema validator in Node.
- node:crypto sha256.
- Python bake scripts: the LAMMPS PyPI wheel, as make_phase_trajectories.py already uses; xtb 6.x CLI offline only (LGPL, never shipped to the browser).
- tools/bake-glimbin.mjs.
- Half-float binary outputs.
- No runtime dependency.

**Backend:** DOM/CPU (tooling and Learn text)

**Rides (v10 requirements):** none (with R9, manifests stay out of specId and the export fingerprints)

**v9 slice:**

All of it. First PR:
- schema, validator and the adapter for the three published Cu manifests
- nomenclature classes for diamond_crystal, graphene_ribbon, c60_buckyball and cnt_6_6
- visible 'recreation' labels
- C60's geometry source found, or relabelled 'idealised geometry, source unrecorded'

**WebGL2 fallback:** Not rendering-related; identical on every device.

**Where in code:**

- tools/sims/make_phase_trajectories.py (write_manifest -> lupi-provenance/1)
- new tools/verify-provenance.mjs, modelled on tools/audit-gallery-claims.mjs
- scripts/generate_timeseries_animations.py (retire or tag as recreation)
- packages/ui/src/gallery-nomenclature.json and galleryNomenclature.ts
- packages/ui/src/gallery-data.json (c60_buckyball metadata)
- packages/ui/src/studyFacts.ts and StudyLensPanel.tsx
- packages/ui/src/mcpViewerBridge.tsx
- LICENSE-DATA.md

**Risks:**

- Steward bandwidth: keep the first shelf to about 12 items.
- Schema churn: version it and keep the sim adapter.
- Relabelling recreations may feel like a demotion: they keep their cards.
- Computed frequencies without an adopted scale factor won't match lab values: show both rungs side by side rather than fudging a factor.

**Honesty:** The contract becomes auditable: no manifest, no twin. It also corrects a round-1 factual slip (sand_w_cascade is not a run) before anything is built on it. Manifests describe data; they never enter deterministic export identities.

**Judges:**

- E 4/keep: A provenance schema that is a superset of the existing lupi-sim-manifest/1, with a CI validator and a named steward, is a prerequisite for every baked twin (modes, cascades, anneals). It is tooling only, ships on v9, and stays out of specId. *Improve:* Start with ~12 items and the Cu adapter, and require rmsdToDisplayed for any mode bake.
- P 2/keep: Provenance plumbing for baked data: necessary for honesty and invisible to players. *Improve:* Start with only the Mode Harp and cu_melt manifests.
- A 2/keep: Outside my lens. *Improve:* Learn should render the provenance in the same Etched Type readout style.
- Pr 5/keep: Exactly what the contract requires: 'the publisher named by a source manifest owns its claims'. It is also the gate for every new bake, and it surfaced that the C60 file's source is undocumented. *Improve:* Name the steward in each manifest, and cap the first shelf at about 12 items.
- M 3/keep: Plain-words provenance helps everyone; lens-neutral tooling. *Improve:* Include approximate byte sizes in the manifest so P-12 can show size chips for baked twins.

<a id="r2-real-twins-science-03"></a>
## Charge, Release, Then Melt It for Real
`R2-real-twins-science-03` · flagship · effort M · judges mean **3.8** (E4 P4 A4 Pr4 M3; keep 5) · self-scored fun 5 / visual 5 · perf costs

> Charge any molecule with unitless pretend heat and it jiggles, then pays off in a dandelion burst. Its Twin Door match-cuts into real copper melting, where the same thumb keeps dragging a thermometer through a real melting point.

**Framing:** problem->solution

**Builds on:** C033 (rework) + C030 + C072 + C041

**Problem:**

C033 was fun, but it claimed 'amplitudes that scale like real thermal motion', borrowed kelvin (product steward), and hid behind a hold that flickers (mobile judge).

Its physics was also wrong. For a classical harmonic bond the mean-square displacement is kT/kappa, independent of mass. Mass sets how fast an atom moves (v_rms ~ sqrt(kT/m)), not how far, so sqrt(T/m) amplitudes teach the wrong thing.

Meanwhile cu_melt (26,400 atoms, 101 frames, published manifest) is the most spectacular real data Lupi owns, and it sits behind a generic frame slider.

**Solution:**

(1) The Heat chip (DOM, in the thumb zone) arms the toy. A pretend slider reads calm / lively / wild, with no kelvin. Each tap on the chip adds heat (one iOS switch haptic per tap; holding also charges, with Android vibrate ticks).

(2) Pretend jiggle, using the engineer's cheap form: an integer hash of (instanceIndex, floor(t*rate)), lerped between keys, with one amplitude per level. Rate scales with 1/sqrt(mass) from a per-type palette channel, so light atoms flicker faster, not farther; that is qualitatively true of velocities. No bond flicker. A temperature colour map (blackbody ramp) blends over element colour at 30% or less, with luminance changing below 3 Hz.

(3) Releasing at 'wild' fires the C030 burst (the playtester's charge-and-release). Atoms hang, then condense home on the house tokens.

(4) At the settle, the Twin Door: 'Pretend heat. Real copper melts from the outside in. See it (45 MB; about 9 MB demo size on phones).'

(5) Match-cut: the ember tint persists while cu_melt condenses in, from a gas cloud seeded around the slab's bounds to frame 0.

(6) The C072 thermometer takes over under the same thumb: vertical drag on empty space scrubs frames. Kelvin now appears, because it is data: the thermostat set-point, computed exactly from the published manifest (dump every 700 steps over a 60,000-step 300->1700 K ramp). Frames 0-85 rise 16.3 K per frame; frames 86-100 hold at 1,700 K. It is labelled 'thermostat set-point', not measured temperature.

(7) A detent and tick sit between frames 63 and 64, at about 1,340 K, Cu_u3's melting point per the scenario. The experimental 1,357.77 K is cited separately: two rungs, two numbers.

(8) The twin has a goal: 'Where does melting start?' Scrub to the tick and tap where you see disorder first. Answer card: 'At the free surfaces (top and bottom of the slab), then inward.'

(9) A reverse chip, 'Cool it too fast', opens cu_solidify: 'No crystal forms; it freezes into glass.'

(10) The colour map is labelled 'temperature colour map, not glow'.

**Experience:**

Phone: tap the Heat chip up to three times, or drag the pretend slider; the atoms tremble. A fourth tap, or a release at 'wild', bursts. The door appears in the thumb zone, and the same thumb then drags up and down on the canvas to heat real copper; Android ticks at the melting detent.

Desktop: H arms, hold Space to charge, release to burst. T opens the twin. Up/Down step frames, PageUp/PageDown jump 10, M jumps to the melting tick.

Screen reader: the pretend slider's aria-valuetext is 'lively (pretend)'. The thermometer is role=slider with aria-valuetext '1,345 K set-point, melting, frame 64 of 101'.

Reduced motion: pretend heat is one still with the tint and a caption; the burst is two stills; the thermometer steps through stills.

Budget: the pretend layer costs O(1) CPU and a few ALU ops per atom in the vertex stage. It runs as an fps-capped job only while heating, then goes back to demand. The twin loads only on tap, at demo size on phones and under Save-Data.

**Tech:**

- R3 TSL positionNode deformer (hash jitter).
- configureTSL/useUniforms mood-bus uHeat (v10 canary hooks, alpha).
- R4 bond pairs follow the jitter.
- C030 tokens on math/time spring.update.
- @pmndrs/scheduler job fps cap plus onIdle.
- Existing glimbin streaming and PlaybackScrubber.
- Temperature-map palette upload only when the bucket changes (C072 engineer).
- T(frame) derived from the manifest protocol.
- navigator.vibrate on Android; the iOS switch haptic on DOM taps (library-author claim, needs a device test).

**Backend:** [GPU+GL2] pretend layer; DOM/CPU thermometer, door and handoff

**Rides (v10 requirements):** R3, R4, R7

**v9 slice:**

Ship on v9:
- the thermometer with the exact set-point mapping, melting detent and cited Tm
- the 'where does it start' goal
- the cu_solidify reverse twin (all C072)
- pretend heat for small molecules only (up to about 5k atoms): the CPU writes a seeded jitter 'target' frame a few times a second and eases the existing uProgress hook between keys, with zero new GLSL; buffers are restored before any export
- the burst, via the engineer's gas-cloud-on-uProgress slice

**WebGL2 fallback:** Full fidelity: the jitter is closed-form in the vertex stage and needs no compute. In Low Power Mode (detected by a locked 33.3 ms cadence) the jiggle key rate halves and the twin defaults to the demo-size run.

**Where in code:**

- packages/ui/src/app/PlaybackScrubber.tsx and ChronosHUD.tsx (thermometer skin)
- packages/ui/src/gallery-data.json (cu_melt, cu_solidify)
- packages/scene/src/AtomsOptimized.tsx and interpolation.ts (the uProgress slice; R3 port target)
- packages/ui/src/coloring (temperature map)
- tools/sims/make_phase_trajectories.py (publish demo-size runs and manifests)

**Risks:**

- A caffeine-to-copper jump can feel like bait-and-switch: the door says so in words.
- Only showcase sizes are published (45, 34 and 58 MB): demo sizes must be baked and published before the phone launch.
- Set-point versus instantaneous temperature confusion: labelled.
- 'Surface first' is visible but would read more clearly with a per-atom crystal-order column. The glimbin says hasProperties: false today, so that would be an optional analysis bake.

**Honesty:** Units appear only on the real side. The pretend jiggle makes no amplitude claim, which fixes C033's mass-amplitude physics error. The potential's melting point and the experimental one are shown as two separate rungs. The pretend layer and the colour map stay outside deterministic export.

**Judges:**

- E 4/keep: The pretend heat is a cheap closed-form hash jitter keyed on floor(t·rate), with the rate set by 1/√mass. It is uniform-driven, full fidelity on GL2, and hands off to a real v9 thermometer. The weak point is data: 34-58 MB showcase runs are too heavy for phones on cellular. *Improve:* Implement the jitter as a Touch Field slot kind. Bake phone-size runs and gate large ones behind Pocket Data Plan size chips.
- P 4/keep: Charge then release is a classic juicy mechanic (the charge shot), and the burst is a great payoff; the real melt door is a bonus. But the jiggle half needs R3, and the jump from caffeine to copper is odd. *Improve:* Ship charge-to-burst on v9 through Keyframe Relay (a charge ring, then the burst, no jitter). Keep the melt door on the same molecule (copper) wherever possible.
- A 4/keep: Charge-then-burst is a strong beat, and the match-cut into real copper melting is the best twin moment in the round. But lerping between integer-hash keys gives C0 kinks, so at 'wild' the jiggle will look like buzzing noise. *Improve:* Use smooth per-atom noise (a sum of sines, or TSL mx_noise) with amplitude capped per Look. Use the blackbody colour only on the real twin.
- Pr 4/keep: The canonical toy with a real twin: unitless pretend heat that hands off to a cited melting point, with a v9 thermometer. But the published showcase runs are 45-58 MB, too heavy for phones, and the caffeine-to-copper jump can feel like bait-and-switch. *Improve:* Ship the v9 thermometer and its reverse twin first, and bake phone-sized runs before the door goes live.
- M 3/keep: It names LPM behaviour and puts haptics on DOM taps, which is correct. But the real twin streams are 34-58 MB (the packet says demo sizes must still be baked), and whole-molecule jitter is continuous motion. *Improve:* Bake demo-size twins with P-12 size chips before any phone lane, show one still per heat level under reduced motion, and give the jitter flash class none with capped amplitude.

<a id="r2-real-twins-science-04"></a>
## Every Atom Came Home (Almost): Burst to a Real Cascade
`R2-real-twins-science-04` · science-toy · effort L · judges mean **2.8** (E3 P3 A4 Pr2 M2; keep 2, park 3) · self-scored fun 4 / visual 5 · perf costs

> The dandelion burst always reassembles perfectly because it is pretend. Its twin is a newly baked copper collision cascade where you guess, then watch, how many atoms never find their way home.

**Framing:** problem->solution

**Builds on:** C030+C080 (rework)+C065+C095 (guess) + the sand_w_cascade audit

**Problem:** Round 1 made sand_w_cascade the burst's real twin, but that file is one frame with a painted damage column, labelled 'representative recreation', and the repo's synthetic 'shockwave' generator could have made it look like a run. C080's slingshot was judged fun but goalless (playtester) and data-heavy (mobile judge). The burst itself teaches nothing: every atom returns because we told it to.

**Solution:**

(1) Bake a real run through the existing scenario registry: cu-cascade.
- A Cu block at 300 K, around 20^3 fcc cells (~32k atoms, the same size class as cu_melt).
- One primary knock-on atom at three energies the steward picks (for example 0.5, 1 and 2 keV).
- EAM Cu_u3 plus the core LAMMPS pair_style zbl for close approach; the splice choice goes in the manifest.
- NVE core with a thermostatted border shell, a variable timestep (fix dt/reset; confirm it is in the wheel's package set) and time-based dumps (dump_modify every/time) over about 10-20 ps.
- The registry needs a small extension for NVE plus border-thermostat phases and time-based dumping.

(2) Offline Wigner-Seitz analysis against the perfect lattice produces a sidecar per frame (displaced now, vacancies, interstitials), the final Frenkel pairs, and a per-atom 'ended off-site' flag, as provenance kind analysis. The manifest states that counts depend on the potential and on the defect method. If several seeds are baked, all are published.

(3) In-app: the burst settles ('Every atom came home: this was pretend'). Door: 'Real is weirder: when a fast atom hits real copper, almost all go home. Not all.'

(4) The twin's goal (the playtester's condition). A slingshot pull chooses the energy: three detents for three baked runs. Before playing, a log-scale guess: 'How many end up out of place? 0 / ~3 / ~30 / ~300'. Then the run plays with a counter fed by the sidecar ('displaced now: ... / at the end: ...'). Final off-site atoms glow softly through the R2 flag byte. The answer card compares guess and result.

(5) C065 comet-tail ribbons on the fastest atoms, not a full-frame afterImage (art director), labelled 'trail connects recorded frames'.

(6) Match-cut: the burst's cloud is seeded around the block's bounds and condenses into frame 0.

**Experience:**

Phone: double-tap is contested, so the burst fires from the Burst chip or from heat charge-and-release. The door shows the run's size. Pull the slingshot with one finger on its DOM control (Android tick per energy detent, iOS haptic on detent taps). Guess with the thumb, then scrub with the thermometer-style scrubber.

Desktop: 1/2/3 pick the energy, G focuses the guess, Space plays, arrows scrub.

Screen reader: 'Energy 1 keV. Your guess: about 30. Result: 12 atoms ended out of place; 1,4xx were displaced at the peak.' (Numbers come from the sidecar; these are placeholders.)

Reduced motion: three stills (before, the peak with displaced atoms highlighted, after) plus the counter.

Budget: streaming playback only after a tap; demand frames while paused; Save-Data confirms the byte size first.

**Tech:**

- LAMMPS PyPI wheel (as make_phase_trajectories.py uses) with pair_style zbl (core, per the LAMMPS docs) and eam.
- tools/bake-glimbin.mjs.
- Python Wigner-Seitz analysis (numpy/scipy KD-tree) offline.
- lupi-provenance/1 kinds sim and analysis.
- Existing glimbin streaming and PlaybackScrubber.
- math/time spring for the slingshot band.
- R2 flag byte plus selective bloom (half-resolution, off on phones by default) for off-site atoms.
- C065 ribbons; C030 tokens.

**Backend:** DOM/CPU playback (v9) + [GPU+GL2] burst, flags and tails

**Rides (v10 requirements):** R2, R3, R4 (R6 optional, for bloom)

**v9 slice:**

Ship on v9:
- bake, manifest and sidecar
- streaming on v9 with the existing scrubber and a DOM counter
- off-site atoms coloured by the existing per-atom property colouring if the glimbin carries the flag column (the glimbin manifest has hasProperties; verify the path), otherwise by selection markers
- the burst, via the uProgress gas-cloud slice

**WebGL2 fallback:** Playback is renderer-agnostic. Flags and tails are vertex and fragment work only, so they run on GL2. Bloom is optional and off on phones and GL2 by default. In Low Power Mode the default is the lowest energy at demo size.

**Where in code:**

- tools/sims/make_phase_trajectories.py (Scenario and Phase extensions)
- new tools/sims/analyze_ws.py
- tools/bake-glimbin.mjs
- packages/ui/src/gallery-data.json (new card)
- packages/ui/src/AtomTrails.tsx (ribbons)
- packages/ui/src/app/PlaybackScrubber.tsx
- apps/web/public/archive/w_cascade_150keV.lammpstrj (relabel as a recreation; never a twin)

**Risks:**

- Cascade setup is specialist MD (ZBL splice, variable timestep, border thermostat) and needs someone who has run cascades.
- Low-energy cascades can leave zero defects on some seeds. That is a fine answer, but never cherry-pick seeds silently.
- A phone-sized box must still contain the cascade.
- Data weight on cellular.

**Honesty:** A real run replaces a recreation, and the burst's lie ('every atom came home') becomes the setup for the real lesson. Seeds, method and defect-counting method are in the manifest. The burst, tails and glow stay outside deterministic export.

**Judges:**

- E 3/park: Rendering is cheap: v9 playback, with flags and tails as vertex and fragment work. The cost is a specialist MD bake (ZBL splice, variable timestep, border thermostat, Wigner-Seitz analysis) that nobody on the team has shown they can run. *Improve:* Revisit once the Science Shelf has a steward who has run cascades, and reuse sand_w_cascade meanwhile.
- P 3/keep: 'Guess how many atoms never come home' is a good hook and cascades are spectacular, but it needs a specialist bake and watching is passive. *Improve:* Pair it with Scratch Deck, so the player scrubs the cascade back and forth with a thumb.
- A 4/keep: A real cascade with off-site atoms flagged and comet tails is a powerful image, and an honest one. *Improve:* Draw tails as ribbons (C065) with no bloom on phones, and take the home and off-site colour pair from Okabe-Ito tokens.
- Pr 2/park: A new specialist MD run (ZBL splice, variable timestep, thermostatted border) is research-grade execution. It needs an expert and a named publisher, and it is effort L. *Improve:* Salvage a sand_w_cascade playback with a DOM counter of atoms that never came home.
- M 2/park: L effort, specialist cascade MD, and ~32k-atom trajectory streams make this heavy on phone data and memory. *Improve:* Revisit with a small bake, a size chip and a storyboard-of-stills path.

<a id="r2-real-twins-science-05"></a>
## The Mode Harp: Poke It, Then Hear How It Really Rings
`R2-real-twins-science-05` · science-toy · effort M · judges mean **4.4** (E5 P5 A4 Pr4 M4; champion 2, keep 3) · self-scored fun 5 / visual 4 · perf neutral

> After a few pretend poke-ripples, the ripple chip offers the molecule's real computed vibrations as harp strings. Each string plays one normal mode on the atoms, with its wavenumber, an explicit xN exaggeration, and a tone 37 octaves down.

**Framing:** capability->problem

**Builds on:** C028+C073+C041+C093

**Problem:** C028's ripple is the best first touch but says nothing true. C073's pluck is true, but it left tap ownership, mode choice and provenance open. Judges asked for a manifest (method, version, scaling), an xN chip, keyboard-reachable modes, and the ripple as the fallback where no modes exist. Nobody noticed that v9 can already play a normal mode exactly.

**Solution:**

(1) THE CAPABILITY. A normal mode is linear, so base + A*sin(phi)*m equals a linear interpolation between (base - A*m) and (base + A*m) at progress (1 + sin phi)/2. Lupi's v9 atoms AND bonds already interpolate instancePosition -> instanceTargetPosition by uProgress, so one mode plays exactly on v9 with zero new GLSL. On v10 it becomes a closed-form C027 deformer (mode buffer x uniform amplitude) with a CPU twin for the picker and labels.

(2) THE BAKE. GFN2-xTB (xtb 6.x, offline --ohess) for 9 of the 12 curated molecules: water, ethanol, acetone, benzene, caffeine, aspirin, phenol, glucose and C60. Stored as half-float mode vectors, manifest kind modes. The manifest records rmsdToDisplayed, because the modes are computed at the xtb-optimized geometry and shown on the PubChem geometry. Frequency scale stays 1.0 unless a published factor is adopted. Diamond, the ribbon and the tube are withheld: their files are periodic cells cut open, and honest modes need periodic models. The tube gets the measured RBM relation instead.

(3) THE HARP. A DOM strip of 3-6 strings per molecule, curated and named by the steward:
- water: bend, symmetric stretch, asymmetric stretch
- benzene: ring breathing
- C60: its two Ag modes, breathing and pentagonal pinch
- acetone: C=O stretch
- ethanol: O-H stretch
Each string shows its wavenumber marked '(computed)'. The amplitude chip reads 'x40 exaggerated', and the motion says it is 'slowed about ten trillion times'.

(4) THE TONE. f = wavenumber * c / 2^37, about 0.218 Hz per cm^-1: 1,600 cm^-1 plays at 349 Hz, and C60's ~496 cm^-1 breathing mode at 108 Hz. Phone speakers can't reproduce low tones, so a 'played an octave up' note appears when the harp transposes. Sound is opt-in, with an 8-voice cap and a caption per tone (C041). Tap two strings for a chord.

(5) THE MEASURED RUNG, where it exists: cited lab band positions shown beside the computed value, never averaged. Examples are NIST Chemistry WebBook IR bands for the small organics and C60's Raman Ag lines near 496 and 1469 cm^-1; the steward sources a primary reference for each.

(6) TAP OWNERSHIP. Tap = ripple everywhere (pretend). On a baked molecule, after the third poke, the ripple chip becomes 'Hear it really ring'. With the harp open, tapping an atom plucks the mode in which that atom moves most (argmax of |m_i|).

**Experience:**

Phone: poke, poke, poke, then the chip. The harp slides up while the molecule rides the sheet (C026). Strings are 44 px DOM buttons, so the iOS switch haptic fires on each pluck, and the molecule rings.

Desktop: hovering a string previews it silently, click plucks, P plucks at the focused atom.

Keyboard: Tab across strings, Enter plucks, +/- change the exaggeration.

Screen reader: 'Bend. Computed 1,6xx per centimetre, played as a 349 hertz tone. The H-O-H angle opens and closes.' It is an audio-first toy blind users can play.

Reduced motion: each string shows both extremes as two stills with arrows; the tone still plays.

Budget: at most 60 atoms and 174 modes; mode buffers are kilobytes. An always job runs only while a string sounds (about 2 s of spring decay), then the viewer sleeps.

**Tech:**

- Offline xtb 6.x (CLI only).
- Half-float buffers.
- v9: the uProgress two-extremes trick.
- v10: useBuffers (instancedArray) mode vectors times a useUniforms amplitude in the R3 positionNode, plus R4 bond pairs (canary hooks, alpha).
- math/time spring.update with dampingRatio < 1 for pluck envelopes.
- Web Audio OscillatorNode and GainNode.
- @pmndrs/scheduler onIdle.

**Backend:** [GPU+GL2] (v10 deformer); DOM/CPU plus the existing uProgress hook (v9)

**Rides (v10 requirements):** R3, R4 for the v10 deformer; none for the v9 slice

**v9 slice:** The whole single-mode harp ships on v9: modes via the extremes trick, strings, sound, manifest and Learn card. Chords (two modes at once) wait for v10, because two modes are not one lerp.

**WebGL2 fallback:** Full fidelity: the deformer is closed-form in the vertex stage and needs no compute. In Low Power Mode the animation job's fps halves; the tone is unaffected.

**Where in code:**

- packages/scene/src/interpolation.ts, AtomsOptimized.tsx and Bonds.tsx (uProgress)
- packages/ui/src/lib: the click-sound synth exists but has no UI toggle; reuse its AudioContext
- new tools/science/bake-modes.py
- apps/web/public/science/modes/<id>/
- packages/ui/src/StudyLensPanel.tsx

**Risks:**

- On v9 the trick writes displaced positions into the atom buffers, so ExportManager must restore them before capture (C027's export CI test, applied early).
- Computed frequencies will differ from lab values: show both rungs.
- Mode naming needs a chemist.
- The sound default is an open product call.

**Honesty:** The motion is data, and the exaggeration and the slow-down are both stated. Computed and measured values stay on separate rungs. Tube modes are withheld rather than faked from a cut-open cell. Harp motion stays outside deterministic export.

**Judges:**

- E 5/champion: The extremes trick is exact. A normal mode is linear, so base + A·sinφ·m is a lerp between base − A·m and base + A·m at (1 + sinφ)/2. Today's uProgress atoms and bonds therefore play real computed modes on v9 with zero GLSL, and in R3 it becomes a closed-form deformer. The one hazard is that on v9 displaced positions are written into the buffers, so ExportManager must restore them. *Improve:* Land C027's 'export bytes identical with play active' CI test with this. Defer chords to v10, and fold cross-14's amplitude colour map in as the still/reduced-motion view.
- P 5/champion: Pluck a molecule and see and hear its real modes as harp strings. The extremes trick (lerp between base−A·m and base+A·m) means it ships on v9 with zero GLSL, moving C073 from after the port to now. Strings are tactile, captioned, and every tap gets sound plus motion. Risks: export must restore the buffers, and a strings UI can crowd a phone. *Improve:* Put the strings in a DOM strip in the thumb zone, so iOS taps buzz. Make C60's breathing mode the first string, and phase-lock the tone to the lerp.
- A 4/keep: Real normal modes are the most beautiful motion in the set: smooth, true and symmetric. *Improve:* Show the ×N amplitude chip in Etched Type, and draw the strings as ink hairlines rather than a harp skeuomorph.
- Pr 4/keep: The v9 extremes trick is clever: it delivers C073's modes early with zero new GLSL. Computed modes with a manifest stay inside the contract. It hosts Chladni's amplitude map. *Improve:* Ship three molecules first with the rung 'Computed: GFN2-xTB', and restore the display buffers before export.
- M 4/keep: The zero-GLSL v9 harp is small-amplitude and optional-sound, and LPM halves only the job's fps. *Improve:* Under reduced motion show FM-11's static mode-arrow diagram. Keep visual oscillation at 3 Hz or less, and caption every tone.

<a id="r2-real-twins-science-06"></a>
## Section View: The Knife That Snaps to Real Planes
`R2-real-twins-science-06` · science-toy · effort M · judges mean **4.2** (E4 P4 A5 Pr4 M4; champion 1, keep 4) · self-scored fun 4 / visual 4 · perf neutral

> Swipe a knife through any structure. The halves pop apart as pretend motion, but the cut face is a measurement: the atoms on the plane are drawn as a clean technical section. In crystals the blade magnets to real lattice planes; in benzene it proves the ring is flat.

**Framing:** problem->solution

**Builds on:** C035+C096+C038 (one shared focus style)

**Problem:** C035 is juicy, but its science was only implied. Judges asked for a clean section face instead of sparks (art director), a Knife chip with keyboard plane presets (mobile judge), and C096's cleave goal. D5 asks the knife to hand off to real crystal planes, and benzene's knife to show the flat ring.

**Solution:**

(1) TWO LAYERS, TWO RUNGS.
- Pretend: the halves separate along the plane normal on an under-damped spring and heal (C003's boing token).
- Derived: atoms whose centres lie within +/- tol of the plane (tol = 0.25 Å for molecules, half the layer spacing for crystals) are drawn as flat section caps in element colour, using a ray-plane cap inside the sphere impostor. Crossing bonds are cut cleanly (endpoint signs in the bond shader). No bloom sparks (art director, flash guard).

(2) READOUTS, as text via aria-live:
- benzene: 'Cut through 12 of 12 atoms. Farthest from the plane: 0.00 Å. The ring is flat.'
- fcc (111): 'N atoms on this layer, 6 in-plane neighbours each: hexagonal.'

(3) REAL PLANES. When a structure has a curated lattice descriptor, the blade magnets to low-index planes (100), (110) and (111) through the nearest atomic layer, names the plane, and ticks at each layer while you drag. Descriptors: diamond_crystal (cubic diamond, a = 3.567 Å, axis-aligned, 4x4x4 cells); cu_melt frame 0 (fcc, with the lattice constant from the scenario); and the procedural sc/bcc/fcc generator. For fcc, d(111) = a/sqrt(3), d(100) = a/2 and d(110) = a/(2 sqrt 2).

(4) CLEAVE GOAL (C096 absorbed): 'Find the hexagon hidden inside the cube.' Turn the blade until the section shows a hexagonal layer; the answer card names (111).

(5) MOLECULES. An Edge-on preset fits a plane to the heavy atoms with a hand-written 3x3 symmetric eigen solve, then puts both the blade and the camera in that plane. From the committed files:
- benzene and phenol: 0.00 Å
- caffeine's heavy atoms: 0.00 Å
- aspirin's ring: 0.00 Å, but one oxygen sits 2.34 Å out of the ring plane
- glucose's ring: 0.26 Å (puckered)

(6) TWIN. The section is already derived data. For crystals, the door can add a cited, open-licence image of a real surface once the steward sources one.

**Experience:**

Phone: the Knife chip swaps one-finger drag from orbit to cut (the Play-chip grammar). A swipe cuts; two-finger rotate turns the blade; DOM step buttons move one layer, with a haptic tick on each tap.

Desktop: K arms, drag to cut. X/Y/Z align the blade to the axes; 1/2/3 pick (100)/(110)/(111); [ and ] step layers; E goes edge-on; Space separates and heals.

Screen reader: every cut announces its atom count, distance and pattern name.

Reduced motion: no separation; the section appears as one still.

Budget: one plane uniform and one dot product per atom. The readout is computed on the CPU on release, or at 10 Hz for up to 50k atoms using SpatialHash slab queries.

**Tech:**

- math plane3.fromCoplanarPoints / fromNormalAndPoint / distanceToPoint (verified in 0.1.0).
- A hand-written Jacobi eigen solve for the plane fit (about 40 lines; math has no eigen solver).
- A mood-bus plane uniform with If() branches in the R3 impostor fragment (cap) and positionNode (separation).
- R4 bond-shader endpoint signs.
- R2 flag byte for on-plane atoms.
- SpatialHash slab queries.
- Curated lattice descriptors as derived manifests, CI-verified so every atom maps to a site.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R2, R3, R4

**v9 slice:** CPU plane fit and slab counts with the text readouts, the Edge-on camera detent (camera only), and on-plane atoms marked with the existing SelectionMarkers (MeshBasicMaterial, which carries into WebGPURenderer). No caps and no separation on v9: that would be throwaway GLSL.

**WebGL2 fallback:** Full fidelity: the cap is fragment work and the separation is a vertex offset. Low Power Mode drops the separation spring's job fps.

**Where in code:**

- packages/scene/src/AtomsOptimized.tsx (R3 target)
- packages/scene/src/Bonds.tsx and bondImpostor.ts
- packages/scene/src/SpatialHash.ts
- packages/ui/src/SelectionMarkers.tsx
- packages/ui/src/measurements.ts (a new plane readout beside distance and angle)
- packages/ui/src/mcpViewerBridge.tsx (the sc/bcc/fcc generator)
- the Cu manifests (lattice constant)

**Risks:**

- Lattice detection from arbitrary files is hard: ship curated descriptors only.
- Section caps at 1M atoms depend on the gate spike's early-Z answer.
- The swipe collides with orbit: resolved by the chip.

**Honesty:** The only pretend element is the separation spring, and it heals. Every number is computed from the displayed file, with the tolerance stated. The cut and the separation stay outside deterministic export.

**Judges:**

- E 4/keep: A ray-plane cap inside the sphere impostor, plus endpoint-sign bond cuts driven by a plane uniform and If(), rides R3 and R4 with no recompile. v9 ships honest CPU plane-fit readouts. Caps at 1M atoms depend on the early-Z answer. *Improve:* Use curated lattice descriptors only, and make the separation a Touch Field slot.
- P 4/keep: A swipe knife that pops the halves apart is a Fruit Ninja verb with a real payoff: benzene proves flat, and the blade finds lattice planes. It needs the arbiter to own the swipe, and R3 for the section caps. *Improve:* Ship a v9 slice (an edge-on detent plus slab highlight), and give the cut a satisfying 'shunk' sound and a snap-heal.
- A 5/champion: A clean technical section cap is a distinctive house image (round 1's 'Section View language' spark), true by construction and free of sparks. Snapping to real lattice planes and fitting the plane in benzene turn it into proof. *Improve:* Specify the cap style (flat element colour, ink rim, an out-of-plane hatch) in a shared overlay spec, and keep the separation spring gentle.
- Pr 4/keep: The cut face is a Derived measurement and the separation is pretend. It proves benzene is flat, and it snaps to real planes on curated crystals. *Improve:* Use curated lattice descriptors only, and answer every cut in text first.
- M 4/keep: No bloom sparks (flash guard), text readouts via aria-live, keyboard plane presets and a camera-only v9 slice. *Improve:* The arbiter owns the swipe only in Knife mode. Section caps at phone scale wait for PT-09 data.

<a id="r2-real-twins-science-07"></a>
## Twelve Prompts, Twelve Toys: An Answer Button for Every Curated Molecule
`R2-real-twins-science-07` · flagship · effort L · judges mean **3.6** (E3 P3 A3 Pr5 M4; champion 1, keep 4) · self-scored fun 4 / visual 3 · perf neutral

> Replace the Learn panel's generic 'Try it' list with one bespoke toy per curated student molecule. Each toy answers that molecule's own observation prompt, ends in a text answer card measured from the file, and links to its real twin.

**Framing:** problem->solution

**Builds on:** STUDENT_COLLECTION prompts + C038+C039+C035+C076 (Kabsch)+C091+C094+C085 + the Mode Harp, Section View, Lantern and Carbon Shape Proofs ideas

**Problem:** STUDENT_COLLECTION has 12 molecules, each with an observation prompt ('Does the shape look straight or bent?', 'Look for different polygon shapes'). Yet StudyLensPanel shows the same three generic tips for all 12: rotate, open Style, select atoms. The collection's steward note says prompts ask for observations, not experimental properties or bond orders, so the toys must answer by observing this file, not by lecturing.

**Solution:**

An 'Answer it' chip under each prompt arms that molecule's toy. The chip owns the one-finger verb; drag on empty space still orbits. Every toy ends in an Answer Card: one sentence with numbers measured from the displayed file (Derived rung), read by aria-live, and stamped in the passport ('12/12 answered').

Per-molecule toys (numbers computed from the committed XYZ files):

- water (3 atoms). Bend Dare: drag an H toward straight (pretend offset; an angle readout climbs), let go, and it springs back. Card: 'This file's H-O-H angle is 104.0°. Water is bent.' Twin: measured gas-phase 104.48° (CCCBDB, Hoy & Bunker 1979), noting that PubChem's geometry is a computed model; the Mode Harp's bend string; then 'Zoom out' into the water journey.

- ethanol (9). Bond Walk: tap the O and a bead rides the bonds O -> C -> C, clicking at each atom. Card: 'The oxygen sits at the end of a two-carbon chain.' Twin: the Atom Ledger's fermentation card.

- acetone (10). Neighbour Lantern on the carbonyl carbon. Card: 'Three neighbours in one plane: angles 121.6°, 121.6° and 116.7° add to 360°. A flat triangle.' Twin: the C=O stretch string.

- benzene (12). Edge-on Knife. Card: '12 of 12 atoms within 0.00 Å of one plane: flat from the side, a hexagon from above.' Twin: ring breathing.

- caffeine (24). Element Sonar: tap anywhere and a ring sweeps the bond graph; nitrogens and oxygens answer with their own plink until all 4 N and 2 O are found, and the formula C8H10N4O2 assembles as you go. Card: 'Two N in the six-ring, two in the five-ring; both O hang off carbons outside the rings.'

- aspirin (21). Group Highlighter: tap any O and its group lights, acid or ester, from curated atom-index lists that CI checks against the file hash. Card: 'Two O-containing groups. The ring is flat, but one oxygen sits 2.34 Å out of its plane.' Twin: the existing /study/organic-functional-groups guide.

- phenol (13). Spot the Difference: drag a ghost benzene over phenol, and on release it snaps with a Kabsch fit on the six ring carbons. Card: 'Added: one oxygen, carrying an H. The rings overlap exactly (both are ideal 1.395 Å hexagons in PubChem's computed models).'

- glucose (24). Ring Count: tap the ring and it outlines; O inside the ring lights one colour, O outside another. Card: '1 oxygen in the ring, 5 outside. The ring is puckered (0.26 Å), unlike benzene's.' Twin: the respiration and fermentation ledgers.

- diamond_crystal (512). Lantern plus the Always-Eight Cell. Card: 'Interior atoms have 4 neighbours at 1.54 Å.'

- graphene_ribbon (96 C + 16 H). Scrub the lantern from middle to edge. Card: 'Middle carbons have 3 carbon neighbours; edge carbons have 2 carbons and 1 hydrogen.' The file repeats along its length, so atoms at those ends are shown with ghost neighbours from the next repeat, not as edges.

- c60_buckyball (60). Polygon Wrap. Card: '12 pentagons, 20 hexagons.'

- cnt_6_6 (96). Unroll, plus a 'look down the tube' detent. Card: 'Unrolled, it is the same hexagon sheet as the ribbon; diameter 0.81 nm.'

**Experience:**

Phone: the prompt and its Answer chip sit at the top of the Learn sheet. Every toy needs only taps and at most one drag, and every card reads at a glance.

Desktop: A arms the toy, and each toy's keys appear in the chip's tooltip.

Keyboard: the accessible atom cursor from D2 drives every toy (Enter performs the armed verb).

Screen reader: every toy can be completed by keyboard and yields its card as text, so a blind student can answer all 12 prompts.

Reduced motion: each toy's still is its card plus one annotated frame.

Budget: at most 512 atoms, overlays only, demand frames.

**Tech:**

- Hand-written graph walk and ring perception (at most 112 atoms).
- Kabsch or Horn fit (about 80 lines) and a plane fit.
- math quat.slerp for snaps; spring.update for the boing.
- Curated per-molecule sidecars (group atom indices, lattice descriptors) as derived manifests.
- The existing GhostAtoms (MeshBasicMaterial; its setter has no callers today) for the ghost benzene.
- SelectionMarkers.
- Web Audio plinks with captions.

**Backend:** mixed (mostly DOM/CPU overlays; [GPU+GL2] where a toy moves atoms)

**Rides (v10 requirements):** none for 9 of the 12 toys; R3/R4 for the Bend Dare offset, Unroll and section caps

**v9 slice:** 9 of the 12 ship on v9 as overlays built on built-in materials, which carry over to WebGPURenderer and are not throwaway: ethanol, acetone, caffeine, aspirin, phenol, glucose, diamond, ribbon and the C60 hull. Water's Bend Dare works on v9 through a 3-atom target frame on uProgress. Benzene's toy is a camera detent plus a readout. The tube's continuous unroll waits for v10; v9 crossfades its two end states.

**WebGL2 fallback:** Same content. Overlays and closed-form deformers run on both backends.

**Where in code:**

- packages/ui/src/gallery/studentCollection.ts (add a toy id per entry)
- packages/ui/src/StudyLensPanel.tsx ('Try it' becomes the Answer chip and card)
- packages/ui/src/studyFacts.ts
- packages/ui/src/GhostAtoms.tsx
- packages/ui/src/SelectionMarkers.tsx
- packages/ui/src/organicFunctionalGroups.ts (group concepts)
- new packages/ui/src/answers/<id>.ts

**Risks:**

- Twelve bespoke toys is a lot of polish: build them from four shared primitives (lantern, plane, walk, overlay) and keep each toy under about a day.
- Answer cards could feel like a quiz: they stay short and celebratory ('Found it: bent!').
- Curated atom indices drift if a file changes: CI checks them against the sha256.

**Honesty:** Answers come from the displayed file. Property claims (the measured water angle) appear only on the twin side, with a citation, which respects the collection's 'observations, not properties' rule. Pretend offsets (the Bend Dare) stay outside deterministic export.

**Judges:**

- E 3/keep: Answering each curated prompt is the right content goal, and the v9 overlays use built-in materials that survive the port. Twelve bespoke toys is effort L of polish. *Improve:* Ship four first (water, benzene, C60, diamond), built from the four shared primitives.
- P 3/keep: A bespoke toy per curated molecule gives variety, and the water Bend Dare is a good one. But Answer Cards push toward a quiz, and 12 toys is L effort. *Improve:* Build from four shared primitives and ship four first (water, benzene, C60, caffeine). Make the answers celebratory, not school-like.
- A 3/keep: Twelve bespoke overlays risk twelve visual dialects. *Improve:* Build every toy from the four primitives in one overlay style: hairline weight, ink token and Etched Type.
- Pr 5/champion: The best contract-fit fun in the set. Each curated student molecule gets a toy that answers its own observation prompt with an Answer Card measured from the file, and 9 of the 12 ship on v9. It is effort L and heavy on steward time. It hosts real-twins-08 and real-twins-09. *Improve:* Build four shared primitives first, keep each toy to about a day, and get steward review on every card.
- M 4/keep: Answer cards measured from the file are read by aria-live, and 9 of the 12 toys run on v9 overlays. *Improve:* Give every toy PE-07 alternatives and no timed dares. The passport count must be reachable entirely by keyboard.

<a id="r2-real-twins-science-08"></a>
## Neighbour Lantern and the Always-Eight Cell
`R2-real-twins-science-08` · science-toy · effort M · judges mean **3.2** (E3 P3 A4 Pr3 M3; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> Tap or scrub across atoms and each one lights its neighbours inside a thin glass shape (line, bent, triangle, tetrahedron) and plinks its coordination. In diamond, drop a cell-sized box anywhere and it always holds exactly eight atoms.

**Framing:** problem->solution

**Builds on:** C038 (recast)+C009+C024+C091 (goal) + the water, acetone, diamond and graphene prompts

**Problem:** Four curated prompts ask about neighbours or local arrangement (water, acetone, diamond, graphene). The X-ray box (C038) was 'a feature with handles' to the playtester and fiddly on phones to the mobile judge. The viewer can select atoms, but it never shows the shape their neighbours make.

**Solution:**

LANTERN.
- Once armed, a tap (or a hold-and-slide scrub using C009's finger-sized ID patch) lights the atom's neighbours. Neighbours come from source bonds if the file has them, otherwise from the viewer's inferred guides, and the card says which.
- A thin derived polyhedron joins the neighbour centres, with bond lengths and angles as labels.
- Shape names come from coordination and geometry: 2 -> line or bent (with the angle); 3 -> flat triangle if the atom lies within 0.05 Å of its neighbours' plane, otherwise pyramid; 4 -> tetrahedron.
- A plink pitched by coordination number plays, with a caption.
- Periodic files (ribbon, tube) use the minimum image along their periodic axis; a neighbour across the repeat shows as a ghost labelled 'from the next repeat', not as an edge.
- Diamond's surface atoms have fewer neighbours: 'The file was cut here.'

ALWAYS-EIGHT CELL (C038 recast as a goal).
- In diamond_crystal, a Cell chip drops a cube of edge a = 3.567 Å (from the curated lattice descriptor) centred on the tapped atom. Drag or nudge it anywhere.
- The counter uses a half-open box, so any translate of one full lattice cell that stays inside the crystal holds exactly 8 atom centres.
- When the box is lattice-aligned, the card adds the textbook split: '8 corners x 1/8 + 6 faces x 1/2 + 4 inside = 8'.
- Goal: 'Find a spot where it isn't 8.' Inside the crystal you can't; near the file's edge the count drops ('that's where the file ends').
- Inside atoms glow through the R2 flag byte; outside atoms ghost through an OBB test in the shader.

**Experience:**

Phone: tap an atom, or hold and slide to scrub the lantern across the sheet. A graphene run from middle to edge is a satisfying chain of changing shapes and pitches. The cell is tap-to-place plus four DOM nudge arrows, with no 3D handle dragging.

Desktop: hover previews the lantern, click pins it. Arrows move the cell by a/4, Shift+arrows by a.

Keyboard: the atom cursor walks the bonds; L toggles the lantern; C places the cell.

Screen reader: 'Carbon 212: 4 neighbours at 1.54 Å, tetrahedron, angles 109.5°.' and 'Cell holds 8 atoms.'

Reduced motion: no scrub animation; each tap is a still.

Budget: CPU neighbour queries via SpatialHash (cell rejection keeps them cheap on large files). Counts run on release or at 10 Hz. Ghosting is a uniform branch.

**Tech:**

- SpatialHash (existing).
- math obb3.containsPoint and box3; half-open counting.
- Hand-written angle and plane helpers.
- R2 flag byte for inside glow; R3 impostor If() on box uniforms for ghosting.
- C009 RGBA8 ID picking on v10; the existing AtomPicker on v9.
- Polyhedron edges as instanced thin cylinders, because WebGPU has no wide lines; faces as low-opacity MeshBasicMaterial.

**Backend:** [GPU+GL2] ghosting; DOM/CPU counts and lantern geometry

**Rides (v10 requirements):** R2, R3 (ghosting); C009 picking (R3/R6 ID target)

**v9 slice:** Lantern shapes, labels, sound and the cell counter with a wireframe box ship on v9 using built-in materials. No ghosting on v9.

**WebGL2 fallback:** Identical, except that transparency sorting of the thin faces can differ on the WebGL2 backend, so GL2 uses an opaque tint.

**Where in code:**

- packages/scene/src/SpatialHash.ts and AtomPicker.tsx
- packages/ui/src/SelectionMarkers.tsx, MeasurementLayer.tsx and measurements.ts
- packages/ui/src/KnowledgeLabelsLayer.tsx (labels; R8 shim later)

**Risks:**

- Inferred-bond neighbours can be wrong on strained files: the card then says 'neighbours within X Å'.
- The 1/8 + 1/2 split appears only when the box is lattice-aligned within tolerance.
- Label clutter on phones: labels only on the pinned atom.

**Honesty:** Everything shown is derived from the file, with its cutoff stated. 'Always 8' is a true property of any lattice-cell translate, and the edge-of-file case is named rather than hidden. The glow and ghosting stay outside deterministic export.

**Judges:**

- E 3/keep: Cheap CPU counts and lantern geometry. The half-open always-eight cell is a lovely derived fact. Thin transparent faces need an opaque tint on GL2. *Improve:* Build it as one of real-07's primitives rather than a separate toy surface.
- P 3/keep: 'Drop a box anywhere and it always holds eight' is a magic-trick moment. The lantern itself is an inspection tool. *Improve:* Lead with the always-eight trick as a secret rather than with the lantern UI.
- A 4/keep: Coordination polyhedra are a classic, elegant crystallographic visual. 'Thin glass' faces will muddy the view on phones. *Improve:* Use hairline edges plus a faint opaque tint on every backend, with no glass.
- Pr 3/merge: Merge into R2-real-twins-science-07. The lantern and the always-eight cell are good primitives for the water, acetone and diamond prompts. *Improve:* Make it one of Twelve Prompts' four primitives.
- M 3/keep: It uses an opaque tint on GL2 and has sound cues; it is useful, but the lantern shape is mostly visual. *Improve:* Announce the coordination shape and angles as text, and do the scrub with P-02's loupe rather than a precise drag.

<a id="r2-real-twins-science-09"></a>
## Carbon Shape Proofs: Wrap the Cage, Unroll the Tube
`R2-real-twins-science-09` · science-toy · effort M · judges mean **3.6** (E4 P3 A4 Pr3 M4; keep 4, merge 1) · self-scored fun 4 / visual 5 · perf neutral

> Shrink-wrap C60 in a faceted hull whose faces sort themselves into 12 pentagons and 20 hexagons and then reveal an icosahedron, and unroll the (6,6) nanotube into the same hexagon sheet as the graphene ribbon. Exact geometry, pretend motion, no shatter.

**Framing:** problem->solution

**Builds on:** C039 (rework, no shatter)+C027 (deformer)+C021 (detent)+C073 (twin)

**Problem:** Judges called C039's shatter a gimmick, its OIT glass costly on phones, and its hull weak on lattices (just a box). They asked for no shatter, opaque facets on phones, a 50k-atom cap, and face and habit labels on C60 and diamond. The C60 and tube prompts ask about polygon shapes and about comparing a tube with a sheet, which are exactly what these two proofs show.

**Solution:**

WRAP.
- quickhull3 runs on the atom centres; coplanar triangles merge into polygon faces within a normal tolerance. For C60 that gives 32 faces, 12 pentagons and 20 hexagons (every atom in the file is 3-coordinated).
- Faces are tinted by polygon type from an Okabe-Ito pair, with thin edges. Opaque facets on phones and GL2; optional thin OIT glass on WebGPU desktops.
- Tap faces to count them ('pentagon 7 of 12'). 'Connect the pentagon centres' then grows a derived icosahedron (12 vertices, 20 triangles) from the pentagon centroids.
- Card: '12 pentagons and 20 hexagons. Any closed cage made only of pentagons and hexagons, with three bonds per atom, has exactly 12 pentagons (Euler's formula).'
- Lattices are honestly boring: 'This hull is the box the file was cut into, not a crystal shape.' For brilliant_diamond_macro: 'The facets of a jeweller's cut (procedural), not natural growth.'
- Capped at 50k atoms; the hull moves to a worker above about 10k points.

UNROLL.
- The tube's radius is 4.068 Å and it repeats every 9.838 Å along its axis (from the file's Lattice line).
- It unrolls by a closed-form deformer that keeps every circumferential arc length exact at every instant: the radius grows as R(t) = r/(1 - t) while angles shrink by r/R. It bends but never stretches, and ends flat at (r*theta, z), 2.56 nm wide.
- Ghost copies from the periodic repeat extend it into a strip, and the graphene ribbon appears alongside with matching hexagons.
- Label: 'Geometric unrolling. Real nanotubes grow from a catalyst particle; they are never rolled from a sheet.'
- A 'look down the tube' camera detent (C021) sits on the axis.

TWINS.
- Measured: the radial breathing mode relation for isolated tubes, omega ~ 248/d cm^-1 (Jorio et al., PRL 2001), predicts about 305 cm^-1 for this 0.81 nm tube: 'Scientists measure a tube's width by listening to this mode.'
- C60: the harp's breathing string.

**Experience:**

Phone: the Wrap chip, then tap faces. Unroll is a pretend slider with no units, or a two-finger spread. The tube detent is one of the flick's snaps.

Desktop: W wraps, click faces, I shows the icosahedron. U unrolls; drag the slider or scroll.

Keyboard: Tab cycles faces, each announced. U / Shift+U unroll and roll. D snaps down the tube.

Screen reader: 'Face 7: pentagon. 12 pentagons, 20 hexagons found.' and 'Unrolled: flat hexagon sheet, 2.56 nm wide.'

Reduced motion: the wrap is one still; the unroll is three stills (tube, half, flat).

Budget: 60-96 atoms, trivially small hull inputs, demand frames.

**Tech:**

- math quickhull3 (it allocates; worker above about 10k points).
- triangle3.normal for the coplanar merge.
- The derived icosahedron.
- A closed-form unroll deformer f(base, t) with a CPU twin, so the picker and labels stay right mid-unroll, in the R3 positionNode.
- Periodic ghosts from the file's Lattice line.
- MeshStandardMaterial facets (built-in, so they carry over to WebGPURenderer).
- oitPass (r186) on WebGPU desktops only.

**Backend:** [GPU+GL2] opaque facets and unroll; [GPU] optional glass

**Rides (v10 requirements):** R3 (unroll deformer), R6 (OIT, desktop only)

**v9 slice:** Wrap with opaque facets, face counting and the icosahedron, as plain three meshes (no GLSL). Unroll on v9 is a crossfade between its two exact end states: interpolating tube to strip linearly on uProgress would cut chords, so v9 shows no in-between.

**WebGL2 fallback:** Opaque facets (no OIT; OIT on GL2 would also lose MSAA). The unroll is vertex-only and runs at full fidelity.

**Where in code:**

- new packages/ui/src/shapes/hull.ts (plus a worker)
- packages/scene/src/AtomsOptimized.tsx (R3 deformer)
- packages/ui/src/app/CameraManager.tsx (detent)
- packages/ui/src/gallery-data.json (c60_buckyball, cnt_6_6, graphene_ribbon, brilliant_diamond_macro)

**Risks:**

- The coplanar-merge tolerance depends on geometry quality, and the C60 file's source is undocumented: fix provenance first.
- The unroll could imply a formation process: the label says it isn't one.
- The hull must not read as an electron surface: thin edges, flat tints, and the label 'hull drawn through atom centres'.

**Honesty:** Both proofs are exact geometry of the file. The only pretend element is the unrolling motion, labelled as not a formation process, and the shatter is gone. Hull and unroll stay outside deterministic export.

**Judges:**

- E 4/keep: quickhull3 on C60's centres yields exactly 12 pentagon and 20 hexagon faces after a coplanar merge. The unroll is a closed-form deformer with a CPU twin, and opaque facets run everywhere with OIT on desktop only. It hosts cross-04's roll. *Improve:* Document the C60 file's provenance first. Run quickhull in a worker above ~10k points.
- P 3/keep: Wrapping C60 into 12 pentagons and 20 hexagons and revealing an icosahedron is a clean aha, but counting faces is more lesson than toy. *Improve:* Move the nanotube unroll into Roll a Nanotube, and make the C60 wrap a Secret Pack entry.
- A 4/keep: Hull faces sorting themselves into 12 pentagons and 20 hexagons, and an unroll that keeps every arc length exact, are beautiful geometric reveals. *Improve:* Make facets opaque in a low-chroma Okabe-Ito pair with the spheres poking through, like a mineralogy model. Share the roll deformer with cross-04.
- Pr 3/merge: Merge into R2-real-twins-science-07. The C60 hull resolving into an icosahedron is an exact answer to a curated prompt. The unroll overlaps Roll a Nanotube. *Improve:* Take the wrap into Twelve Prompts and leave the unroll to cross-04.
- M 4/keep: Okabe-Ito face tints are colour-blind-safe. Facets are opaque on phones and GL2, with OIT only on desktop. *Improve:* Make face counting keyboard-reachable, and show the unroll's two exact end states as stills under reduced motion.

<a id="r2-real-twins-science-10"></a>
## Sketch It, Then Meet It: Tap-Tap Builds That Land on Real Records
`R2-real-twins-science-10` · science-toy · effort L · judges mean **2.8** (E2 P3 A3 Pr3 M3; keep 3, park 2) · self-scored fun 4 / visual 3 · perf neutral

> Tap element chips onto glowing open sockets to sketch a small molecule. When every valence is filled, Lupi looks it up (gallery first, PubChem on request) and the sketch condenses into the real 3D conformer. Lupi never computes the shape.

**Framing:** problem->solution

**Builds on:** C074 (rework)+C030 (condense, rebuild)+C068 (resolve-to-real)+C009 (socket picking)

**Problem:** C074 needed drag, which is unreliable on touch; a lazily loaded openchemlib MMFF94 relaxation, which is heavy and is in-browser computation that needs labelling; and it competed with PhET's Build a Molecule. Judges asked for tap-tap builds that resolve to real gallery or PubChem entries, relaxation only on 'done', and a speedrun launched from the burst. Lupi has no openchemlib dependency today, but it already has a PubChem PUG REST loader and 64 molecules with PubChem CIDs in gallery-nomenclature.json.

**Solution:**

(1) A GRAPH, NOT PHYSICS.
- H, C, N and O (F and Cl later), up to 12 heavy atoms, neutral closed-shell molecules only.
- Tap an element chip (DOM, so iOS switch haptics fire), then tap a glowing socket on the sketch. Sockets show only while an element is armed (art director).
- Tap a bond to cycle single, double, triple; undo is always available.
- Sketch geometry comes from simple direction templates (tetrahedral, trigonal, linear via quat.rotationTo) and is labelled 'sketch geometry'.

(2) RESOLVE. 'Done' means every valence is filled. Lupi builds a canonical graph key (elements, connectivity and bond orders; no stereo) and looks it up:
(a) first in a bundled index built at build time from the 64 nomenclature entries' own files;
(b) then, only on an explicit tap of 'Look it up on PubChem' and honouring Save-Data, by sending a hand-written Kekulé SMILES to PUG REST compound/smiles/.../cids and loading the 3D conformer with the existing fetchPubChemCompound.

(3) CONDENSE. Sketch atoms map onto the conformer's atoms by graph isomorphism (tiny graphs; brute force with element partitioning), and the sketch condenses into the real conformer on the house tokens, labelled 'transition'. Card: 'You built ethanol. This 3D shape is PubChem's computed conformer (CID 702). Lupi looked it up; it did not calculate it.'
- Several stereoisomers: 'Other stereoisomers share this connectivity; showing CID X.'
- Not found: 'Valid on paper, but not in our library or in PubChem. It may be unstable, or simply unrecorded.' Never 'impossible'.

(4) REBUILD CHALLENGE (the playtester's speedrun, within the product steward's scope). After a burst of a curated small molecule, 'Rebuild it' drops its atoms into the element tray; you rebuild by tap-tap, and the reward is watching it condense back into the real file. A tap count is shown; a timer appears only if the player opts in.

(5) RESOLVE-TO-REAL AS A SHARED SERVICE. The same call later backs C068's doodle ('your doodle's outline resembles benzene': a resemblance score, never an identity) and the cutter and growth endings.

**Experience:**

Phone: two thumbs, and every action is a tap. The left thumb holds the element chips; the right taps sockets.

Desktop: click the same way, or type: C/H/N/O arm an element, Tab moves socket focus, Enter places, B cycles bond order, Backspace undoes, L looks it up.

Screen reader: 'Carbon 2: two open bonds. Sockets: up-left, down.' The card is text, so the whole toy works without seeing the canvas.

Reduced motion: the condense becomes a crossfade from sketch to conformer.

Budget: tiny graphs; one PubChem request per explicit lookup; a bundled index of a few KB.

**Tech:**

- Hand-written valence graph, canonical key (Morgan-style refinement), Kekulé SMILES writer and isomorphism mapper.
- math quat.rotationTo, spring.update, and mulberry32 for rebuild layouts.
- The existing packages/ui/src/molecules/pubchemLoad.ts (fetchPubChemCompound, pubchemSourceUrl).
- CIDs from gallery-nomenclature.json.
- v9 uProgress for the condense (from = sketch, to = conformer).

**Backend:** DOM/CPU. Ships whole on v9; the sketch atoms are the user's own source coordinates, not offsets.

**Rides (v10 requirements):** none (R3 only adds a per-atom stagger to the condense)

**v9 slice:** All of it, including the condense via uProgress (without the stagger).

**WebGL2 fallback:** Unaffected: normal atom rendering.

**Where in code:**

- packages/ui/src/molecules/pubchemLoad.ts
- packages/ui/src/gallery-nomenclature.json
- new packages/ui/src/build/ (graph, smiles, resolve)
- packages/scene/src/interpolation.ts
- packages/ui/src/store.ts (a user-built LoadedFile whose sourceUrl becomes pubchem://cid/...)

**Risks:**

- Charged or radical sketches are refused, with an explanation.
- PubChem outages: the bundled index still works offline.
- PhET overlap: Lupi's hook is meeting the real 3D record, not the building itself.
- The isomorphism mapper must handle symmetric hydrogens deterministically.

**Honesty:** No geometry is computed in the browser. The only shapes shown are the labelled sketch and a cited record, and 'not found' never claims non-existence. A resolved molecule is an ordinary loaded record. The condense animation stays outside deterministic export.

**Judges:**

- E 2/park: The cost outruns the payoff. It needs a hand-written canonical key, a Kekulé SMILES writer and an isomorphism mapper for sketches of up to 12 heavy atoms, in territory PhET already owns. The resolve-to-a-real-record hook is good, but the machinery is effort L. *Improve:* If revived, resolve through PubChem's structure search plus a small bundled key index of gallery entries, and cap the scope at 6-8 heavy atoms.
- P 3/keep: Tap-tap building, paid off by meeting the real molecule as it condenses, is satisfying. But sketching valences on a phone is fiddly, and PhET owns this space. *Improve:* Start with 3-4 atom 'guess the molecule' presets so the first success lands in 10 s.
- A 3/keep: 'Glowing open sockets' is a glow trope. *Improve:* Draw sockets as ink rings, and resolve the sketch through sig-07's condense.
- Pr 3/park: PhET owns molecule building, and a hand-written canonical SMILES writer and isomorphism mapper is a scope trap. *Improve:* Salvage the 'resolve to a real record' step for doodles.
- M 3/keep: Tap-tap building (no drags, untimed) suits switch access, but it is L effort and overlaps PhET. *Improve:* Use socket targets of 44 px or more, keyboard socket cycling, and announced valence state.

<a id="r2-real-twins-science-11"></a>
## The Atom Ledger and Tracer Mode: Bookkeeping, Then the Experiments That Actually Followed Atoms
`R2-real-twins-science-11` · science-toy · effort L · judges mean **2.6** (E2 P2 A3 Pr3 M3; keep 2, park 3) · self-scored fun 4 / visual 4 · perf neutral

> Drop one molecule onto another. If Lupi has a cited reaction for the pair, the reactants dissolve into an element-sorted ledger tray and the products assemble from it (bookkeeping, not mechanism). Where isotope experiments really traced an atom, Tracer mode shows where it went.

**Framing:** problem->solution

**Builds on:** C077 (rework)+C030 (tokens)+C094 (recipe stamps) + curated glucose and ethanol

**Problem:** C077's flying atoms read as a reaction mechanism (product steward), were passive (playtester), and needed Hungarian mapping. Judges asked for the label 'atom bookkeeping, not mechanism', a source per reaction, 3-4 precomputed mappings on the uProgress hook, and discovery by dropping one molecule onto another.

**Solution:**

(1) CHOREOGRAPHY THAT CAN'T PASS AS MECHANISM. Atoms never fly from reactant seats straight to product seats.
- Hop 1: the reactant molecules dissolve into a ledger tray, a shelf of atoms sorted by element in periodic-table order. It is an accounting device that nobody mistakes for a physical state.
- Hop 2: the products assemble from the tray.
- A DOM ledger mirrors it: 'C 6 = 6, H 12 = 12, O 6 = 6: balanced'.
- The words stay on screen through both hops: 'Atom bookkeeping, not mechanism.'

(2) UNBALANCED. Leftovers stay on the tray with a steady outline, never red flashing, plus a hint: '2 O left over. Add another O2?'

(3) DISCOVERY. Drag (desktop) or tap-tap (phone) one molecule chip onto another. A known pair unlocks a recipe card with its citation. An unknown pair says 'No curated reaction for this pair', never 'they don't react'.

(4) STARTER SHELF. Four reactions, provenance kind ledger-map, conformers from the gallery or PubChem: methane combustion; glucose fermentation (C6H12O6 -> 2 C2H5OH + 2 CO2, linking two curated molecules); aerobic respiration; esterification.

(5) TRACER MODE (Measured rung, kind tracer-map), for reactions where isotope labels really followed atoms. The labelled atom wears a ring, and the card cites the DOI.
- Roberts & Urey (JACS 1938) esterified benzoic acid with 18O-methanol and found the label in the ester, not in the water.
- Ruben, Randall, Kamen & Hyde (JACS 1941) used 18O to show that photosynthetic O2 comes from water.
- Real is weirder: bookkeeping balances 6 CO2 + 6 H2O -> C6H12O6 + 6 O2, but all twelve O atoms in 6 O2 come from water, so the traced equation needs 12 H2O and gives 6 back.

(6) MAPPING DISCLOSURE. For bookkeeping reactions the mapping is element-preserving and chosen to minimise travel: 'Lupi picks which O goes where. This is not a map of any real pathway.'

**Experience:**

Phone: the recipe book is a DOM sheet of molecule chips. Tap one, tap another, and the tray animation plays; ledger rows tick with a plink per balanced element. Tracer is a toggle chip.

Desktop: drag chips onto each other, or onto the molecule in the scene (v10 DOM drag-and-drop onto meshes). Arrows step through the hops.

Keyboard: pick reactants from two listboxes; Enter reacts; T toggles Tracer.

Screen reader: the ledger is a real table. Hops announce 'Reactants to tray' and 'Tray to products', and the tracer card reads its finding in one sentence.

Reduced motion: three stills (reactants, tray, products) with the ledger.

Budget: at most about 100 atoms per reaction scene; two hops of the existing interpolation.

**Tech:**

- Offline-curated ledger and tracer maps: JSON with per-atom from/to indices and citations, CI-checked for per-element conservation.
- Composite scene frames: copies of gallery conformers placed on a layout; spacing is arbitrary, and the card says so.
- v9: uProgress for each hop.
- v10: a per-atom delay attribute plus Hermite arcs in the R3 positionNode (the engineer's closed form), and the R2 flag byte for the tracer ring.
- math/time spring.update and easing.

**Backend:** [GPU+GL2] stagger and arcs on v10; DOM/CPU plus uProgress on v9

**Rides (v10 requirements):** R2, R3, R4

**v9 slice:** Four reactions with two uniform hops (no per-atom stagger), the ledger table, recipe cards, and the tracer ring as a selection marker. No new GLSL.

**WebGL2 fallback:** Full fidelity: the motion is closed-form in the vertex stage.

**Where in code:**

- packages/scene/src/interpolation.ts and AtomsOptimized.tsx
- packages/ui/src/SelectionMarkers.tsx
- new packages/ui/src/ledger/
- apps/web/public/science/ledger/<id>.json
- packages/ui/src/gallery-nomenclature.json (CIDs for the conformers)

**Risks:**

- A stranger might still read hop 1 as 'molecules fall apart into atoms': the words stay visible through both hops.
- Reaction conditions (enzymes, catalysts, heat) are omitted from the choreography and need one line on the card.
- Curating tracer studies needs a chemist and historian check.

**Honesty:** The choreography is designed so it cannot pass as mechanism, and the one case where real atom maps exist is shown as measured, with DOIs. The tray animation stays outside deterministic export.

**Judges:**

- E 2/park: The two-hop uProgress choreography is cheap, but the curation (cited per-atom ledger and tracer maps, composite layouts) is heavy for four reactions, and the mechanism misread persists even with the ledger tray. *Improve:* Revisit after the Science Shelf is running, starting with one tracer experiment.
- P 2/park: The bookkeeping choreography is honest but reads as a lecture, and dragging one molecule onto another is unreliable on touch. *Improve:* Revisit once drag-and-drop onto meshes works on phones, and lead with one tracer-experiment story.
- A 3/keep: An element-sorted ledger tray is a distinctive diagram, but the two hops of flying atoms need careful timing so they don't read as a mechanism. *Improve:* Time the hops on the Condense tokens, and draw the tray as a shelf on the plate.
- Pr 3/park: Every reaction needs a cited map, the omitted reaction conditions are an honesty load, and the first hop may still read as dissociation. *Improve:* Revisit after the Science Shelf, starting with a single cited tracer.
- M 3/keep: The DOM ledger is accessible text, but the effort is L. *Improve:* Show the two hops as stills under reduced motion, and keep the 'bookkeeping, not mechanism' words announced.

<a id="r2-real-twins-science-12"></a>
## Cut It, Then See Real Copper Round It Off
`R2-real-twins-science-12` · science-toy · effort L · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 4, rework 1) · self-scored fun 4 / visual 4 · perf neutral

> Lasso atoms, or stamp a heart out of an ideal copper lattice and keep it as a new structure labelled 'derived, unrelaxed'. Its twin is the same stamped shape run through a real LAMMPS anneal, where the sharp corners soften first.

**Framing:** problem->solution

**Builds on:** C040 (rework)+C030 (reverse condense)+C105 (sticker)+cu_sinter

**Problem:** C040's cookie cutter overclaimed 'real nanoparticles'. Judges asked to ship the lasso first, to label cuts 'derived, unrelaxed, cut from an ideal lattice', for keyboard preset stamps, and for a press-down animation that runs the condense tokens in reverse. Nobody gave the cut a real counterpart.

**Solution:**

(1) LASSO FIRST, as an inspection tool. Draw a loop; atoms whose screen projection falls inside it are selected (polygon2.containsPoint, with the projection done in a worker over SpatialHash cells), and a rubber-band hull hugs them.

(2) CUTTER. Choose a preset (heart, star, sphere, cube, your initial) or draw a freehand loop, extruded to a chosen depth through an ideal fcc Cu lattice (with a from the Cu_u3 scenario). The press animation is the condense motif in reverse: excess lattice falls away (pretend).

(3) OUTPUT. The cut is a new source structure, like C116's frames rather than offsets, saved through the saved-view path with a derived manifest: 'Cut from an ideal fcc copper lattice (a = X Å). Unrelaxed: no simulation has touched these positions.'

(4) TWIN. Each preset has a baked cu-cutout-anneal run: a new registry scenario that reads the exact same carved coordinates via read_data and runs NVT at about 0.6-0.7 Tm for about 100 ps over 100 frames, with a low min_moved_fraction like sinter. Door: 'Real copper doesn't keep sharp corners. Here is this heart after a simulated anneal.' Freehand shapes are never simulated: 'Your shape wasn't simulated. Here is the heart that was.' The family twin is cu_sinter, whose two particles were also carved from ideal lattices and then heated.

(5) SHARE. The cut goes to the sticker press (C105) with an Illustrate outline and the word 'derived'.

**Experience:**

Phone: the Lasso chip owns one-finger drag while it is on. Presets are DOM buttons (an iOS haptic on each stamp), and a stamp presses with a captioned thunk.

Desktop: draw with the mouse. S stamps, 1-5 choose presets, arrows move the stamp, Enter keeps the cut.

Screen reader: 'Heart stamp: 4,312 atoms kept. Derived, unrelaxed.'

Reduced motion: a before and an after still.

Budget: projection and containment run in a worker, and the result is capped by the source lattice size. Anneal downloads are budgeted in single-digit MB per preset, to be verified at bake.

**Tech:**

- math polygon2.containsPoint / winding.
- decomposePolygon2Quick (never the Quality variant on user strokes).
- quickhull2 for the rubber band.
- Worker projection.
- The saved-view path.
- A LAMMPS read_data scenario in make_phase_trajectories.py.
- lupi-provenance/1 kinds derived and sim.
- R2 flag byte for the selection glow on v10.

**Backend:** DOM/CPU (ships on v9)

**Rides (v10 requirements):** none (R2 for the selection glow)

**v9 slice:** Lasso, stamps, derived structures, provenance labels and the baked anneal twins all ship on v9.

**WebGL2 fallback:** Unaffected.

**Where in code:**

- packages/scene/src/SpatialHash.ts
- packages/ui/src/mcpViewerBridge.tsx (the procedural lattice generator)
- packages/ui/src/SavedViewButton.tsx
- tools/sims/make_phase_trajectories.py (new scenario)
- packages/ui/src/gallery-data.json

**Risks:**

- An affordable anneal might show little visible change: bake and look before shipping, and fall back to cu_sinter as the only twin.
- Thin stamps leave atomic chains that behave oddly in MD: tune preset depths.
- Cap the source lattice size on phones.

**Honesty:** The cut is labelled as what it is: ideal and unrelaxed. Its twin shows what real simulation does to such a shape, and only for shapes that were actually simulated. The cut is a real new structure, so it can be exported as such; the press animation and glow stay outside deterministic export.

**Judges:**

- E 3/keep: Lasso-first is a valuable inspection tool: polygon2.containsPoint exists, and projection runs in a worker. The stamp cutter with 'derived, unrelaxed' provenance ships on v9. The anneal twin is another specialist bake. *Improve:* Ship the lasso and stamps now, and use cu_sinter as the only twin until an anneal bake proves visible.
- P 3/keep: Stamping a heart or your initial out of copper is instantly shareable and fun, and the anneal twin is a nice aftertaste. L effort. *Improve:* Ship the stamps first and the lasso later, and offer sticker output right after the stamp.
- A 3/keep: A heart stamped out of copper is sticker-friendly, and the press animation reuses the condense in reverse. *Improve:* Show the unrelaxed and annealed pair side by side on the Contact floor shadow.
- Pr 3/rework: The lasso is a good inspection tool now. The cutter plus a LAMMPS anneal twin adds new bakes with uncertain visible payoff. *Improve:* Ship the lasso on v9, and gate the cutter and anneal on a bake that shows visible rounding.
- M 3/keep: Lasso is a drag verb, so it depends on PE-07's stamps for WCAG 2.5.7. The LAMMPS twin needs baking. *Improve:* Ship the keyboard stamps with the lasso, and announce the derived structure's atom count.

<a id="r2-real-twins-science-13"></a>
## Grow It, Then Meet the Crystal It Was Always Going to Be
`R2-real-twins-science-13` · science-toy · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 4, park 1) · self-scored fun 4 / visual 4 · perf neutral

> Plant a seed or type your name, and a crystal grows site by site on a real lattice under a labelled growth model. It ends by condensing into the real crystal file. Its twins are a real seeded-growth MD run and an anti-twin: a melt quenched too fast to crystallise.

**Framing:** problem->solution

**Builds on:** C078 (rework)+C030 (condense ending)+cu_solidify

**Problem:** C078 is personal and mesmerising, but claiming 'real habits' from a toy KMC overclaims (product steward). Judges asked for a growth-front glow, a cap of about 10 s, reduced-motion stills, and an ending on the real crystal.

**Solution:**

(1) THE SITES ARE REAL; THE ORDER IS A MODEL.
- Growth runs in a worker on the lattice sites of a curated crystal: diamond cubic from diamond_crystal's descriptor, or fcc Cu.
- The rules are integer-only: attachment probability by neighbour count, plus a pretend calm-to-wild knob with no units.
- The seed is FNV-1a(name) fed to mulberry32. The URL carries only the 32-bit seed, never the name.
- There is no trig in the rules, so every device regrows the identical crystal (avoiding math issue #48's float drift).

(2) GROWTH-FRONT GLOW (art director): the newest atoms are bright and cool to element colour. Growth lasts at most about 10 s, then settles and sleeps.

(3) ENDING. The rest of the file's atoms condense in around your crystal. Card: 'Every atom you grew sits on a real diamond lattice site. The order they arrived in was a growth model, not a measurement.'

(4) TWINS.
- A new cu-seeded-growth bake: a crystalline Cu slab in undercooled liquid copper, NVT below Tm, with the crystal front advancing layer by layer (kind sim).
- The anti-twin cu_solidify: 'Cooled too fast, real copper never gets to grow. It freezes into glass.'

**Experience:**

Phone: tap to plant, drag the pretend knob, watch, tap to fast-forward.

Desktop: click to plant, or type a name. Space steps; Shift+Space runs.

Keyboard and screen reader: 'Grown 212 of 512 sites; growth front: 34 atoms; growth model.'

Reduced motion: four stills (25, 50, 75 and 100%) plus the final crossfade.

Budget: at most about 3k sites in a worker; demand frames with a per-job fps cap while growing.

**Tech:**

- Worker KMC over SpatialHash neighbours.
- math mulberry32 (integer-exact) and a hand-written FNV-1a.
- v9: replay as trajectory frames (C078's original plan).
- v10: per-atom birth time in a small attribute or next to the R2 flag byte, with a radius-from-birth-time uniform sweep in the R3 impostor (the engineer's fix).
- A LAMMPS bake for the twin; C030 tokens.

**Backend:** mixed (worker CPU; [GPU+GL2] birth sweep)

**Rides (v10 requirements):** R2/R3 (birth sweep), R7 (fps-capped job)

**v9 slice:** Growth and the ending as a trajectory replay, the cu_solidify anti-twin, and seed links. The seeded-growth bake can ship independently.

**WebGL2 fallback:** The birth sweep is a uniform comparison in the vertex and fragment stages: full fidelity.

**Where in code:**

- new packages/ui/src/grow/ (worker)
- packages/scene/src/SpatialHash.ts
- packages/ui/src/gallery-data.json (diamond_crystal, cu_solidify)
- tools/sims/make_phase_trajectories.py (cu-seeded-growth)

**Risks:**

- Seeded-growth MD needs care: an undercooling and box size where the front visibly moves within the run.
- The name is personal data: it is hashed locally and never sent.
- KMC habits are not real habits: the card says so.

**Honesty:** The model is named as a model, while the lattice sites and the ending are real. The twins are an actual growth simulation and a real counterexample. The glow and sweep stay outside deterministic export.

**Judges:**

- E 3/keep: Integer-only worker KMC gives identical crystals on every device. The birth sweep is a uniform comparison with full GL2 fidelity. Seeded-growth MD is another bake. *Improve:* Ship the growth and the cu_solidify anti-twin first; the growth MD can follow.
- P 3/keep: A crystal grown from your name is personal and shareable, but watching it grow is passive. *Improve:* Let the player tap to seed or bias the growth, as in Crystalscaper, and end on the condense.
- A 3/keep: The glowing growth front risks a bloom trope. *Improve:* Draw the birth sweep as an ink rim rather than a glow.
- Pr 3/park: It needs a seeded-growth MD bake, KMC habits aren't real habits, and it overlaps Crystalscaper. Hashing the name locally is a good privacy pattern. *Improve:* Revisit after the Shelf, as a single growth model.
- M 3/keep: Hashing the name locally is good privacy, and growth is worker CPU. *Improve:* Play growth as held poses in LPM and as a still per stage under reduced motion.

<a id="r2-real-twins-science-14"></a>
## Water, Zoomed Out: A Staged Journey from One Molecule to a Glass
`R2-real-twins-science-14` · flagship · effort M · judges mean **3.4** (E3 P3 A3 Pr4 M4; keep 1, merge 4) · self-scored fun 4 / visual 5 · perf neutral

> Start at the curated water molecule's bend, step out through a 64-molecule cluster where you can tug hydrogen bonds, into a 150-molecule bucket, then leave 3D for honest counted stages (a hair's width, a drop, a glass), each with a guess, a crossfade and a Next-scale button.

**Framing:** problem->solution

**Builds on:** C082 (rework)+C085+C031+C095 + the Mode Harp and Twelve Prompts ideas (water's bend)

**Problem:** C082 was the art director's scale moment, but it carried an engineering risk (depth precision across 6+ orders of magnitude) and a vestibular one (one continuous pinch). The product steward wanted a learning journey that starts from water, not a billion-atom showcase. C085's sticky water was one scene of the tug toy, and C095's guess prompts needed a home. D5 also suggested sticky water as water's observation toy, but tugging hydrogen bonds doesn't answer 'straight or bent?'. The fix: water gets the Bend Dare, and sticky water becomes stage 2 here.

**Solution:**

STAGE 1: ONE MOLECULE (water, 3 atoms, PubChem). The Bend Dare and the harp's bend string. Card: bent.

STAGE 2: A DROPLET (water_cluster_64: 192 atoms, labelled 'Geometry Construction').
- The sticky-water verb (C085 via C031): drag one molecule out, a rigid pretend offset, and watch its hydrogen bonds stretch and snap one by one. A Pull button does the same.
- Hydrogen bonds are thin threads styled explicitly as inferred, using a geometric criterion (O...O <= 3.5 Å and H-O...O <= 30°, after Luzar & Chandler).
- Card: 'In this constructed cluster, each molecule has about N inferred hydrogen bonds' (computed).
- Twin (Measured): water boils at 100 °C, while hydrogen sulfide, a similar-sized molecule without strong hydrogen bonds, boils at about -60 °C.

STAGE 3: A BUCKET (this_is_water: 450 atoms, 120 frames). Its own metadata already says 'stylized loop, not a force-field integration', and those words stay on screen.

STAGE 4 ONWARD: COUNTED, NOT DRAWN.
- 3D stops. The last frame shrinks into a dot on a DOM scale ruler (FLIP), and the ruler keeps going.
- Its numbers are computed from liquid water's density: about 0.997 g/cm3 at 25 °C gives about 30 Å^3 per molecule, or about 3.1 Å spacing.
  - Across a typical hair (~70 µm): about 2.3 x 10^5 molecules side by side.
  - A 0.05 mL drop: about 1.7 x 10^21.
  - A 250 mL glass: about 8.3 x 10^24.
- Each stage opens with a C095-style guess on a log slider ('How many across a hair?'), and the answer card shows how many orders of magnitude you were off.

MECHANICS.
- Each 3D stage has its own near and far planes and its own camera fit, so no log depth is needed.
- Transitions are crossfades (transition() on v10, DOM on v9) or the FLIP into the ruler.
- Pinch is free within a stage; pinching past a stage's limit offers the next stage. There is never a continuous 12-order zoom.
- The billion-atom block is not in the journey. It is copper, not water, and a card says so if it is linked.

**Experience:**

Phone: the Next-scale button sits in the thumb zone. Pinching out at a stage's limit pulses it once. Guess with the thumb.

Desktop: N/P go to the next or previous stage; scroll zooms within a stage.

Keyboard: N/P; G focuses the guess; Enter submits.

Screen reader: each stage is a heading with a one-sentence scene description and its numbers. The guess slider's aria-valuetext reads 'about 10 to the 5th'.

Reduced motion: stages cut with crossfades only; the camera never travels.

Budget: the largest 3D scene is 450 atoms, and everything beyond is DOM. Demand frames. All three files are small and already in the repo.

**Tech:**

- Existing files: water.xyz, water_cluster.xyz, this_is_water.lammpstrj.
- A hand-written hydrogen-bond criterion over SpatialHash.
- A rigid pretend offset, using C027's sparse stored buffer (the one allowed stored offset).
- Threads as thin instanced ribbons (WebGPU has no wide lines).
- R6 transition() crossfades (GL2 behaviour UNVERIFIED).
- A DOM ruler with FLIP.
- math/time spring.update on a log scale for the ruler.
- aria-live.

**Backend:** mixed ([GPU+GL2] stages 1-3; DOM stages 4 onward)

**Rides (v10 requirements):** R3 (rigid offsets), R4 (threads), R6 (transition)

**v9 slice:** The whole journey on v9: DOM crossfades and the ruler; stage-2 threads as static overlays; the Pull animation of one molecule on the uProgress hook (192 atoms, a small target frame).

**WebGL2 fallback:** Same stages. If transition() is unreliable on the WebGL2 backend, a DOM crossfade over a captured still. Low Power Mode changes nothing essential; the ruler is DOM.

**Where in code:**

- apps/web/public/gallery/curated/water_cluster.xyz and apps/web/public/gallery/this_is_water.lammpstrj
- packages/ui/src/gallery-data.json
- packages/scene/src/ScaleBar.tsx and SpatialHash.ts
- packages/ui/src/app/CameraManager.tsx
- packages/ui/src/cameraFit.ts

**Risks:**

- water_cluster_64 is a construction, so its hydrogen-bond count reflects how it was built: say so, and prefer a real MD snapshot if the steward bakes one (water models need LAMMPS packages beyond the Cu scenarios; verify the wheel).
- The art director wanted an unbroken dive: the FLIP into the ruler keeps continuity without pretending to render 10^21 molecules.

**Honesty:** Beyond 450 atoms, nothing is drawn that isn't there. Counts are computed from density, with the assumption stated, and the stylized bucket keeps its own 'not a simulation' wording. The tug, threads and ruler stay outside deterministic export.

**Judges:**

- E 3/merge: Merge into R2-signature-and-moonshots-13. It is the second Powers-of-Ten-from-water pitch. Its value is that stages 1-3 use files Lupi already ships, which makes it Six Sides' v9 slice. *Improve:* Use its existing-asset stages and sticky-water tug as Six Sides' first release.
- P 3/merge: The same staged water journey as Six Sides. Its sticky-water tug stage is the most playable part. Host: R2-signature-and-moonshots-13. *Improve:* Merge the hydrogen-bond tug into Six Sides as the stage between one molecule and the ring.
- A 3/merge: Host: R2-signature-and-moonshots-13. It is the same C082 rework starting from water, and sig-13's snowflake ending is the stronger image and the better question. *Improve:* Carry the sticky-water tug into sig-13 as an optional beat at S1.
- Pr 4/merge: Merge into R2-signature-and-moonshots-13. It starts from the home Water model, and its first three stages ship on v9 using existing files. *Improve:* Make it the first shippable stages of Six Sides.
- M 4/keep: Host for SM-13. Discrete stages with a Next-scale button and crossfades are exactly the vestibular fix round 1 demanded for Powers of Ten. *Improve:* Provide keys for stages, announce the stage counters, and keep every stage's camera still between user inputs.

<a id="r2-real-twins-science-15"></a>
## Real or Pretend? A Daily That Teaches the Honesty Contract
`R2-real-twins-science-15` · share-loop · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 4, merge 1) · self-scored fun 4 / visual 3 · perf neutral

> Each day, two three-second loops of the same molecule: one pretend toy motion, one real simulated or computed motion from the provenance shelf. One question: which one is data?

**Framing:** capability->problem

**Builds on:** C088+C103+C106 + the Evidence Ladder and Science Shelf ideas

**Problem:** The honesty contract stays invisible unless it becomes something visitors want to do. Round 1's only daily loop (C088) is a silhouette guess. The provenance shelf and the twins produce exactly the paired content a daily needs, and the habit it builds, 'Is this motion evidence?', is the curriculum this direction is about.

**Solution:**

PAIRS are generated offline, from manifests only. The 'real' clip must reference a manifest with rung simulated, computed or measured; the 'pretend' clip names its toy. Examples:
- the poke ripple versus C60's computed breathing mode
- the heat jiggle versus cu_melt near its melting tick
- the burst versus the cascade

CLIPS are pre-rendered at a fixed size with the capture service (C103; a v9 loop export already exists) as small MP4/WebM files with posters.

THE QUESTION is framed in words, at the pair level, before anything plays: 'One of these is illustrative (pretend motion). One is data. Which is data?' So pretend motion is never presented unlabelled.

THE REVEAL names both rungs, shows the manifest's one-sentence 'how this was made', and teaches the tell: 'Real vibrations move atoms in coordinated patterns; the pretend jiggle is random.'

SHARE: spoiler-free text ('Real or Pretend #37: got it first try') plus the Illustrate-style card.

It runs as a rotating C088 format: on the home DOM card (zero canvases; video elements show posters and play only on tap, so the owner's 'start still' call holds) and in the viewer.

**Experience:**

Phone: two posters stacked; tap each to play it, then tap the one you think is data.

Desktop: side by side; 1/2 play the clips, Enter chooses.

Keyboard: fully operable.

Screen reader: the steward writes a text description of each motion ('A: every atom trembles on its own. B: the whole cage swells and shrinks together.'), which turns the daily into a reading puzzle with the same answer.

Reduced motion: posters plus a three-frame step-through per clip.

Budget: two small clips a day under a per-clip byte budget set at encode time. Nothing streams until tapped, and there is no WebGPU on home.

**Tech:**

- Offline capture with Playwright, following tools/verify-asset-quality.mjs, or C103's service after R9.
- MP4/WebM with posters.
- A DOM card on v9.
- localStorage history with no streaks (no streak shaming).
- PII-free events: answered, correct, shared.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (R9 later, for in-app capture)

**v9 slice:** Entirely v9, using offline-rendered clips.

**WebGL2 fallback:** Not rendering-related; identical everywhere.

**Where in code:**

- packages/ui/src/landing/ (the Daily card)
- packages/ui/src/analytics (events)
- a new clip baker in tools/
- apps/web/public/daily/

**Risks:**

- It is an explicit exception to labelling every clip, mitigated by the pair-level wording before play and a reveal that always follows.
- If the tell is too easy the daily gets boring: curate a difficulty ladder.
- Motion on home is an owner call; posters are the default.

**Honesty:** Argued exception: the pair is labelled in words ('one is illustrative') before either clip plays, and the reveal always names both rungs. Only manifest-backed clips can be the 'real' one. The clips are illustrative outputs, never MCP artifacts.

**Judges:**

- E 3/keep: Offline clips and a DOM card make it cheap and v9, and it teaches the contract directly. It is an explicit exception to per-clip labelling. *Improve:* Render the clips with capture-01 in CI and publish only pairs whose real clip has a Shelf manifest.
- P 3/keep: 'Which one is data?' is an original daily with real teaching value, but watching two clips is passive and the tell may be too easy. *Improve:* Run it as one rotating Daily format, and add a pause-and-scrub inspection so players have something to do.
- A 3/keep: The pretend and real clips must be rendered identically, or the rendering itself becomes the tell. *Improve:* Render both through cap-01 with the same Shot: same Look, pose and framing.
- Pr 3/merge: Merge into R2-capture-share-loops-10 as a rotating C088 format. It teaches the honesty contract as a game, but clips that are deliberately unlabelled are an exception to the labelling rule, acceptable only inside the Daily's framed question. *Improve:* Frame the question before play, and always follow it with the reveal.
- M 3/keep: Offline clips are data-light, but a 'which motion is real' quiz is visual by nature and has no screen-reader path. *Improve:* Clips are tap-to-play. Add audio or text descriptions of both motions, making it a reasoning quiz rather than a perception one.
