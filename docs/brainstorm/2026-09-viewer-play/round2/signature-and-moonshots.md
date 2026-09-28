# Round 2 · Lupi's Signature Look, and Moonshots Past the Gate Spike

[← all round-2 ideas](README.md)

## Direction notes

This is direction D8. Part A is a house-style spec, "Specimen", built mostly from inconsistencies found in the code rather than from taste.

**Inconsistencies found**
- At least five chrome palettes:
  - home: green-black #101817 with lime #d5ef9c;
  - switcher: Tailwind slate #121824/#334155;
  - RendererFallback: blue-black #0b0e14;
  - og-lupi.png: near-black with a teal bar;
  - softbox IBL tint: blue-grey 0xbfcbdb.
- Two element palettes: landing SVG sage pastels versus the viewer's Jmol CPK.
- A 25k-atom cliff in sceneLooks.ts, where every Look drops env, AO and tone mapping.
- drei ContactShadows draws with scene.overrideMaterial (confirmed in the drei 10.7.9 source). Lupi's atoms are an InstancedBufferGeometry with a custom instancePosition, so by code reading the shadow is not the spheres' shape; verify with a capture.
- PubChem bond orders are typed (pubchemLoad.ts:65) but discarded.
- The main viewer has no device-loss handling; only GPU Studio sets onDeviceLost.

**Tensions resolved**
1. **AO after N8AO.** The house AO is baked directional per-atom AO: Quilez's analytic sphere occlusion packed into L1 SH by the existing counting-sort occlusion worker. It is deterministic and identical on phone, desktop and GL2, and costs nothing per frame. Screen-space AO is demoted to a desktop extra. This is the biggest technical bet.
2. **Illustrate as the print voice.** A CPU SVG engine ships on v9 and covers previews, edge cards, Daily silhouettes, the no-GPU fallback and stickers. It is calibrated against the GPU Look with FLIP goldens. It also makes D1's match frame exact: the landing tile and the first viewer frame share one named camera, which gives the Ink-to-Light arrival.
3. **Palette honesty versus brand.** The Specimen palette keeps CPK hue families, Classic stays one tap away, the palette id enters the spec, and Clear solves the palette per molecule for colour-vision deficiency.
4. **Fewer Looks.** Exactly four: Specimen, Illustrate, Night and Clear. Prism becomes a Remix rare, and any new Look must replace one.
5. **Light Painter and the sky.** Light Painter rotates the house rig through one uniform; r186 also honours scene.environmentRotation (verified). @pmndrs/sky is declined as a world: its README says it requires the WebGPU renderer, GL2 is unverified, and an open sky contradicts the specimen plate.

**Part B: four moonshots**
Each is gated by the gate spike and C014 data, and each has a degrade path that is a real toy, not a different product:
- **Crystal Sand:** an analytic slump-and-heal that even has a v9 slice on the existing uProgress hook.
- **Gallery Print:** justified twice, as a visitor poster and as the physically lit ground truth that tunes the raster Look. Path-traced tiles also remove C114's seam problem.
- **Six Sides:** Powers of Ten reframed as "why snowflakes have six sides". It starts from the home page's water molecule and moves in discrete stages. Real GenIce2 ice-Ih data covers the atomic stages; counts are computed and the illustrations labelled beyond them.
- **Made-Of:** the gist engine's existing setHomes() replaces splats. Particle shares follow atom count, never the model's "rough shares".

**Deliberately left out**
- New catalogue Looks, hologram and electron fuzz.
- VXGI and SSGI beauty modes, which the path tracer supersedes.
- ClusteredLighting "firefly" atoms. The impostor's custom shading bypasses three's light loop unless R3 adopts MeshStandardNodeMaterial with a hit-point positionView, which is unverified.
- GaussianSplat on /scan, continuous zoom, and a live canvas on /. The landing condensation is SVG on touch only.

**Honesty and performance**
No FPS or latency claims are made; durations are motion-token lengths. Every fun-layer effect (strain colour, sand, condense, floor shadow of displaced atoms) is zeroed for export. The palette, the rig and the baked AO are Look data and are recorded in the spec.

**Sources**
- https://iquilezles.org/articles/sphereao/
- https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral
- https://github.com/NVlabs/flip
- https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
- https://jfly.uni-koeln.de/color/
- https://github.com/wwwtyro/speck-pbr
- https://github.com/holtsetio/flow
- https://threejs.org/examples/webgpu_compute_particles_fluid.html
- https://mmacklin.com/uppfrt_preprint.pdf
- https://github.com/genice-dev/GenIce2
- https://www.sciencedirect.com/science/article/abs/pii/S0960077904003741
- https://webbox.lafayette.edu/~reiterc/mvp/sfn/index.html
- https://arxiv.org/pdf/2306.13087
- https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear
- https://github.com/yisibl/resvg-js
- The @pmndrs/sky and @pmndrs/glyph READMEs in scratchpad/research/gh
- The three 0.186.1 build in scratchpad/t186, checked for MaxEquation, onDeviceLost, NeutralToneMapping and environmentRotation

<a id="r2-signature-and-moonshots-01"></a>
## Specimen Tokens: one colour source for page, plate and palette
`R2-signature-and-moonshots-01` · foundation · effort M · judges mean **3.6** (E4 P2 A5 Pr3 M4; champion 1, keep 3, rework 1) · self-scored fun 1 / visual 3 · perf neutral

> One generated token file sets the DOM chrome, the canvas plate, the lighting tint, the element palette, the SVG previews and the link cards, so a molecule on the landing, in the viewer, on /scan and in a chat unfurl looks like the same object in the same room.

**Framing:** problem->solution

**Builds on:** C063 + C045 + C016 + C106 (new: the shared token source they all assumed)

**Problem:** The code has no single colour source. Chrome: the home page is green-black (--home-bg #101817, accent #d5ef9c), the switcher uses Tailwind slate (#121824/#334155/#94a3b8), RendererFallback is blue-black (#0b0e14→#11151f), og-lupi.png is near-black with a teal bar, the procedural softbox's IBL backdrop is tinted blue-grey (backdropTint 0xbfcbdb) and the default viewer backdrop 'gallery-studio' is #29463f→#0b1816. Elements: the landing SVG previews (tools/build-student-previews.mjs) use sage pastels (O #ed927e, N #81a9ed, C #94aaa0), while the viewer uses Jmol CPK from packages/core/src/elements.ts (O #ff0d0d, N #3050f8, C #909090). So the tapped tile and the 3D molecule can't match (D1's match frame), and the canvas reads as a box pasted onto the page.

**Solution:**

1) Source of truth: packages/core/src/style/tokens.ts. A build step emits tokens.css (custom properties), tokens.json (Worker cards, Node scripts, SVG builder) and a TS module for the scene. A lint rule bans hex literals in *.css and *.tsx outside the token file (allowlist for data colours).
2) Token groups: a surface ramp (plate-edge = page background, surface-1, surface-2, line); ink (text, muted, lime accent, a lupine-blue second accent taken from the brand mark); plate centre and edge per Look; light (rig panel colours, IBL tint); palette; motion (C003 springs, also exported as CSS linear() easings); type.
3) The Specimen element palette, generated offline for all 118 elements. Hue comes from Jmol CPK, so the conventions teachers know survive (O red, N blue, S yellow, Cl green). Lightness and chroma are re-authored in OKLCH into bands, so no element glows or sinks against the plate and every colour survives Khronos Neutral tone mapping unclipped. H and C neutrals get a slight warm/cool split. 'Classic (Jmol)' stays one tap away. The landing previews regenerate from the same palette.
4) Continuity rules, checked in CI:
- The plate-edge colour equals the page background (ΔE_OK < 0.02), so the canvas has no visible border when you go from landing to viewer or slide a sheet.
- Panel surfaces are derived from the active Look's plate by OKLCH steps, with text contrast ≥4.5:1 per Look.
- <meta name=theme-color> follows the plate, so the phone's browser toolbar can tint to the scene where the browser supports it.
- RendererFallback, /scan, the switcher, GPU Studio and the Worker's social card adopt the tokens.

**Experience:** Desktop: the page doesn't change colour between the landing and the viewer; the molecule seems to lift out of the page instead of opening in a box. Phone: the toolbar tint matches the plate where supported, and the Style sheet slides over the scene with no seam. Keyboard and screen reader: no behaviour change; CI guarantees text contrast for every Look. Reduced motion: token-driven chrome transitions become instant.

**Tech:** Node build script with a hand-rolled OKLab/OKLCH conversion (~40 lines; math@0.1.0 math/color has no OKLab). math/color colorspace.srgbToLinear for linear palette upload. The existing 256-entry palette DataTexture. CSS linear() easing (Chrome 113+, Firefox 112+, Safari 17.2+) sampled from math/time springs. On v10 the plate and light tokens become mood-bus defaults via useUniforms (@react-three/tsl canary, alpha).

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (on v10 its tokens seed the R3/R5/R6 mood-bus defaults)

**v9 slice:** All of it ships on v9: tokens and CSS, the palette-texture regeneration (no GLSL), the preview rebuild, retinting the fallback, switcher and /scan, and theme-color.

**WebGL2 fallback:** Identical: tokens are data, and the palette is the existing texture upload.

**Where in code:** packages/core/src/elements.ts (color fields); packages/scene/src/constants.ts (TYPE_COLORS); packages/ui/src/landing/student-home.css (--home-*); switcher/switcher.css (--sw-*); scan/scan.css; RendererFallback.tsx (inline gradient); studioEnvironment.ts (backdropTint 0xbfcbdb); backgroundPresets.ts ('gallery-studio'); tools/build-student-previews.mjs (colors object); apps/mcp-worker/src/index.ts (DEFAULT_SOCIAL_IMAGE, social HTML)

**Risks:** A new default element palette is a teaching decision, even with hues preserved. Mitigations: Classic one tap away, a legend that always shows the colours actually drawn, and the palette id carried in URL state. The palette must enter the render spec, so default specIds change. Token discipline decays without the lint rule. theme-color tinting varies by browser and iOS version.

**Honesty:** Element colour is data. The palette never changes hue families, the legend shows the drawn colours, and Classic is one tap away. Because the palette is part of the Look rather than the fun layer, deterministic export records its id instead of excluding it.

**Judges:**

- E 4/keep: One generated token source for the DOM, the plate, the palette texture (an upload, no GLSL) and cards, with a hex-literal lint, ships on v9 and removes colour drift everywhere. A new default palette is a teaching decision. *Improve:* Keep Classic one tap away and carry the palette id in links.
- P 2/keep: One colour source makes home, viewer and cards feel like the same room. No play. *Improve:* Land it with the flagship's match frame.
- A 5/champion: The shared colour source round 1 assumed but never wrote. Making the plate edge equal the page background lets the molecule lift out of the page instead of opening in a box, and the OKLCH-banded palette keeps CPK hues. *Improve:* Resolve the accent conflict: lime in D1 and the tokens, teal in og-lupi.png, and a proposed lupine blue. Keep Classic CPK one tap away.
- Pr 3/rework: One colour source across chrome, plate and cards is right. But a new default element palette is a teaching decision and risks breaking the contract's rule against silently changing a view's visual meaning. *Improve:* Ship tokens for chrome and plate first, and put any palette change to the owner as a separate decision.
- M 4/keep: One token source is the precondition for prefers-contrast and forced-colors theming and for DOM-to-scene contrast continuity. *Improve:* Add contrast-pair tokens and a forced-colors map, and check 3:1 non-text contrast in CI.

<a id="r2-signature-and-moonshots-02"></a>
## The Specimen Rig: one light for every Look, scale and backend
`R2-signature-and-moonshots-02` · system · effort M · judges mean **3.4** (E4 P2 A5 Pr3 M3; champion 1, keep 4) · self-scored fun 2 / visual 4 · perf improves

> Promote the existing procedural softbox rig to Lupi's only light, so its feathered key and overhead-strip catchlight appear on every atom in every Look. Light Painter turns the whole rig through one uniform, and the Look no longer changes character at 25k atoms.

**Framing:** problem->solution

**Builds on:** C044 + C058 (sky declined, sun salvaged) + C045 + C066 + C046 + C048

**Problem:**

Light and backdrop vary by accident rather than by design:
- The Looks already use the zero-network softbox (sceneLooks.ts), but the postprocess presets and environment picker still pull drei HDRs ('studio', 'night', 'sunset'). Those fetch from githack, which the v10 brief flags for self-hosting, and each gives different reflections.
- sceneLooks.ts switches scenes of 25k atoms or more to no environment map, 'diagram' post, no tone mapping and no SSAO, so the same Look visibly changes identity at 25k.
- Every preset uses ACES, which shifts saturated element hues.
- There is no highlight you would recognise as Lupi's.

**Solution:**

1) The house rig is SCIENTIFIC_STUDIO_RIG (key softbox at az40/el45, cool fill, overhead strip, rim card, floor bounce) plus the matching analytic key, fill and rim, PMREM-baked once. Every Look is a set of gains and colours on this one geometry: Specimen as authored; Night with key ×1.2, fill ×0.4, rim ×1.6; Illustrate at a faint key-side tint; Clear near-flat high key. Because no Look moves a panel, the catchlight becomes the recognisable signature. drei HDR presets leave the Look system; backdrop images remain only as backdrops.
2) Output: Khronos PBR Neutral is the default, since it is designed to keep base-colour hue and saturation. AgX lives only in Night's grade, baked into a LUT (C045), so changing Looks doesn't rebuild the output node.
3) Exposure: a grey-card probe (a mid-grey sphere under the key) normalises every Look to one luminance, and the goldens check it.
4) Rotation without a re-bake: the TSL atom and bond materials sample the environment through one mat3 uRigRotation uniform, and the analytic light directions come from the same matrix. Light Painter (C044) therefore turns the whole rig live with no PMREM work. It has detents at Specimen (40/45), Rembrandt, Butterfly and Rim (C021 detent logic), with warmer colour as the key drops. The visible plate doesn't rotate.
5) One look at every scale: remove the 25k branch and swap cost stand-ins per atom by pixel radius, not per scene. Matcap-baked rig lighting (C066) serves far or tiny atoms, the baked per-atom AO from Contact covers occlusion, and plate-tinted depth fog (C046) turns on above ~50k. The Look's name and catchlight survive to 1M atoms.
6) Declined: @pmndrs/sky as a world. Its README says it requires the WebGPU renderer, GL2 is unverified, and an open sky contradicts the specimen plate. C058's draggable sun survives as this rig rotation.

**Experience:** Desktop: tap the Light chip, grab the key and drag. Highlights and shading glide across every atom, and the rig clicks into named setups with the name shown ('Rembrandt'). Phone: a thumb-zone Light chip suspends orbit while it's held, one-finger drag turns the rig, and detent chips give DOM-tap haptics. Keyboard: L focuses the light, arrows step detents, Home resets. Screen reader: aria-valuetext reads 'Key light: Rembrandt, 45 degrees left, 40 up'. Reduced motion: detent-to-detent jumps with a crossfade.

**Tech:** three 0.186.1 NeutralToneMapping and AgXToneMapping (verified in the build); TSL lut3D; PMREMGenerator.fromScene from three/webgpu (a one-time bake); a TSL mat3 uniform on the reflect and normal lookups in the R3 impostor and R4 bond materials (scene.environmentRotation is also honoured by r186 renderObjects, verified, for stock materials); math/time spring.dampAngle for the drag; C066 matcap via useRenderTarget (R3F v10 core, alpha); scheduler demand frameloop with invalidate while springing.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3, R4, R5 (dome material), R6 (output transform)

**v9 slice:**

- Make Neutral the default through the installed postprocessing ToneMappingMode.NEUTRAL.
- Replace drei HDR presets in postprocess presets with the softbox plus per-Look gains.
- Retint the softbox backdrop from tokens.
- Run Light Painter on the existing analytic light uniforms, re-baking the tiny 5-panel softbox PMREM on release (cost unmeasured).
- Keep the 25k branch until the v10 matcap and baked AO exist.

**WebGL2 fallback:** Identical: rotation is a uniform, the PMREM bake happens once, and matcap LOD is one texture fetch. GL2 visitors see the same catchlight.

**Where in code:** packages/ui/src/studioEnvironment.ts (SCIENTIFIC_STUDIO_RIG); SceneLighting.tsx (rig and fill/rim cut above 50k); sceneEnvironment.ts; sceneLooks.ts (the large = atomCount >= 25_000 branch); postprocess/presets.ts (env.drei presets, toneMapping 'aces'); packages/scene/src/AtomsOptimized.tsx and bondImpostor.ts (analyticEnvironment and textureCubeUV lookups to port)

**Risks:** Neutral instead of ACES changes every existing still, though the V2 baselines are re-cut anyway. The per-atom matcap switch can seam, so it needs a crossfade band. Some users liked the HDR variety; backdrops remain. Warmer light at lower angles must not shift element colours in Clear, where that coupling is disabled.

**Honesty:** Lighting is presentation. The rig and its rotation are Look parameters recorded in the render spec. They are not part of the fun layer and never move atoms.

**Judges:**

- E 4/keep: One rig for every Look, with Neutral tone mapping (already exported by the installed postprocessing) as the default now. Rotating the rig is one mat3 uniform, and dropping drei HDR presets removes the external githack fetches. It rides R3, R5 and R6 cheaply. *Improve:* Provide the env-rotation uniform that True Spin needs, and blend matcap LOD with a crossfade band.
- P 2/keep: One recognisable catchlight is art direction, invisible to play. *Improve:* Make Neutral tone mapping the default on v9 now.
- A 5/champion: The heart of 'does it look right'. One rig and one catchlight across every Look and scale, Neutral tone mapping by default, rig rotation as a uniform (Light Painter with no PMREM work), and no identity switch at 25k atoms. Declining @pmndrs/sky is right. *Improve:* Add grey-card and catchlight probes to sig-10, and a crossfade band for the matcap LOD. Warm the key at low angles everywhere except Clear.
- Pr 3/keep: One light across all Looks gives Lupi a recognisable catchlight, and the v9 slice makes Neutral tone mapping the truthful default. *Improve:* Land it after the Four Looks cap.
- M 3/keep: One rig with a matcap LOD for phones; mostly art direction. *Improve:* Put the Clear rung's near-flat key in the same rig.

<a id="r2-signature-and-moonshots-03"></a>
## Contact: baked directional AO and a shadow drawn from the atom buffer
`R2-signature-and-moonshots-03` · foundation · effort M · judges mean **4.4** (E5 P3 A5 Pr4 M5; champion 2, keep 3) · self-scored fun 3 / visual 5 · perf improves

> Replace the lost N8AO look with ambient occlusion baked into each atom (analytic sphere occlusion packed into 4 bytes) and ground small molecules with a floor shadow drawn from the same buffer the toys displace. Both are stable, run on phones, and cost nothing per frame while the scene rests.

**Framing:** problem->solution

**Builds on:** C028 + C030 + C027 + C066 + C007 + C110 (new: sphere-SH AO instead of re-tuning screen-space AO)

**Problem:**

Screen-space AO and the floor shadow both fail the house look:
- The N8AO look goes when vanruesc postprocessing is removed (R6), and phones get no AO today (reduceForMobile).
- Screen-space AO shimmers while rotating, halos the backdrop, and fades once atoms are a few pixels wide.
- The floor shadow is drei ContactShadows, which sets scene.overrideMaterial to a MeshDepthMaterial (drei 10.7.9 source). Lupi's atoms are an InstancedBufferGeometry with a custom instancePosition attribute, so by code reading the override draws un-instanced quads, not the ray-cast spheres (to verify with a capture).
- That shadow is omitted above 50k atoms and frozen during playback.
- The toys (burst, jelly, tug) have no grounding cue that shows height.

**Solution:**

(a) Directional baked AO. The existing occlusion worker (atomOcclusion.ts: QuteMol-style scalar, a counting-sort grid, no per-atom allocation) also accumulates per atom an L1 spherical-harmonic occlusion from neighbours within R. Each neighbour adds a lobe in its direction weighted by the analytic sphere solid angle (r_j/d_ij)² (Quilez's sphere-AO term), packed as one unorm8x4 (c0 plus three directional terms). At its analytic normal the impostor evaluates occ(n) = saturate(c0 + dot(c1, n)). The side of an atom facing its neighbour darkens exactly where they touch, and C60's cage and benzene's ring read. There is no noise, halo or temporal flicker, the result is identical on phone, desktop and GL2, and it costs nothing per frame. Above 50k atoms only the existing scalar byte is kept, because 4 B/atom × 5M is too much memory for phones. While display offsets are active, AO eases toward open in proportion to the offset or burst uniform.
(b) Screen-space AO becomes a desktop extra: half-res ssao() at low weight for bond, shell and floor cross-occlusion only.
(c) Floor shadow from the atom buffer:
- An orthographic pass along the key-light direction draws every atom (base plus the C027 display offset) as a soft disc into a 256² R8 target with MaxEquation blending. Disc radius grows and darkness falls with height above the floor, so the penumbra widens with height.
- One separable blur follows, and a shadow-catcher floor quad multiplies the result into the plate.
- The shadow is re-shot only when atoms or offsets move, the light turns, or the molecule changes (demand; per-job fps cap 30).
- Above 50k atoms the existing far-LOD cluster splats feed the same pass.
- The floor fades at low camera elevations. 'Up' is the fitted world Y from cameraFit.

**Experience:** Phone, including a Low Power iPhone: small molecules sit on an invisible table and show soft contact shading with no post passes. Tap-burst: atoms lift, their shadows spread and pale, then snap crisp as they condense, so the burst reads in depth. Desktop: the same, with a touch of screen-space AO in bond crevices. Keyboard and screen reader: no new controls. Reduced motion: the shadow updates once per still.

**Tech:** The existing counting-sort grid in packages/scene/src/atomOcclusion.ts and occlusionWorker.ts; Quilez analytic sphere occlusion (iquilezles.org/articles/sphereao); an R2 unorm8x4 attribute; the TSL impostor normal; useRenderTarget (R3F v10 core, alpha) at 256² R8; OrthographicCamera; MaxEquation blending (verified in three 0.186.1: gl.MAX on WebGL2, the 'max' blend op on WebGPU); TSL gaussianBlur; scheduler demand and per-job fps.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R2 (attribute), R3 (impostor AO; a disc material reading the same storage buffer and offsets), R6 (optional ssao)

**v9 slice:** Enable the existing scalar baked occlusion for mobile at all atom counts. It is only an attribute plus uOcclusionStrength, with no GLSL change. Retune ContactShadows opacity and blur from tokens. Directional AO and the buffer shadow wait for R3, so there is no throwaway GLSL.

**WebGL2 fallback:** Works as is: an attribute read plus a disc pass with MAX blending, re-shot only on change.

**Where in code:** packages/scene/src/atomOcclusion.ts, occlusionWorker.ts, useAtomOcclusion.ts; AtomsOptimized.tsx (vOcclusion / uOcclusionStrength around lines 497-707); packages/ui/src/app/ViewerScene.tsx (BudgetedContactShadows, CONTACT_SHADOW_* limits); MoleculeShadow.tsx; postprocess/presets.ts (reduceForMobile)

**Risks:**

- L1 SH is a coarse fit, and very tight contacts may band; the per-Look strength is the lever.
- The rest-pose bake lags during tug or sand play (hence the fade rule).
- The shadow pass draws N extra quads into a tiny target; vertex cost at 50k atoms is unmeasured.
- Molecules have no natural 'up'.
- An extra 4 B/atom below 50k atoms must fit the per-atom byte budget.

**Honesty:** AO and shadows are shading. The baked AO is a deterministic function of source positions, so it can be part of a V2 export Look. The floor shadow of displaced atoms is part of the fun layer and is zeroed with the offsets.

**Judges:**

- E 5/champion: It restores AO on phones without screen-space passes. L1 SH occlusion is baked by the existing counting-sort occlusion worker and evaluated at the impostor normal, and the floor shadow is drawn from the atom buffer once per change. The v9 slice needs no GLSL, since baked occlusion is currently gated to large scenes. This is the 'calmer and cheaper' visual win. *Improve:* Reconcile the extra AO word with port-05's per-atom table (16 → ~20 B/atom). Fade AO while offsets are active, and cap shadow atoms.
- P 3/keep: A contact shadow grounds small molecules so they feel like objects you could pick up, and it makes the die, desk and pop-it toys read physically. *Improve:* Prioritise the floor shadow under small molecules for the object toys.
- A 5/champion: It replaces the lost N8AO look with stable, noise-free, per-atom directional AO, plus a floor shadow drawn from the atom buffer that spreads during bursts. It grounds the molecule, has no flicker, and is safe on phones. *Improve:* Measure banding on tight contacts, fade the floor at low camera elevations, and put its 4 B per atom in port-05's ledger.
- Pr 4/keep: Phones regain ambient occlusion through baked occlusion with no per-frame cost. Most visitors are on phones, and the v9 slice is an attribute flip. *Improve:* Enable scalar baked AO on mobile now.
- M 5/keep: Baked AO gives phones the depth cues the mobile post rule forbids, at zero per-frame cost at rest, on both backends. The v9 slice is just enabling existing scalar occlusion on mobile. *Improve:* Cap the shadow disc pass by atom count on phones, and fade the bake during tug rather than rebaking.

<a id="r2-signature-and-moonshots-04"></a>
## Bond Grammar: provenance you can see, orders where the source has them, taffy in Play
`R2-signature-and-moonshots-04` · system · effort M · judges mean **3.8** (E4 P2 A5 Pr5 M3; champion 1, keep 4) · self-scored fun 2 / visual 4 · perf neutral

> Bonds show where they came from: source bonds are solid and split-coloured at the visible midpoint, and distance-inferred bonds are visibly lighter. Double, triple and aromatic bonds appear whenever the source supplies orders (PubChem already does, but Lupi throws them away). In Play, stretched bonds warm and thin like taffy.

**Framing:** problem->solution

**Builds on:** C010 + C031 + C035 + C027 + C049 + C056

**Problem:**

Bonds are drawn one way whatever the evidence:
- Source bonds and distance-inferred bonds look identical in 3D, although the product contract separates supplied from inferred topology and the landing SVG already says 'Lines are distance-inferred visual guides'.
- The two-tone split sits at the geometric midpoint (bondImpostor.ts), so a small atom's colour takes more of the visible stick than a large atom's.
- Frame.bonds holds pairs only, so benzene can't show its ring. Yet the PubChem record type declares bonds.order (pubchemLoad.ts:65) and frameFromPubChemRecord keeps only aid1/aid2.
- Tug and knife toys need a visual language for stretch.

**Solution:**

1) Provenance: source bonds are solid, split-coloured and clearcoated per Look. Inferred bonds are drawn at 0.85× radius, with colours desaturated 35% toward a --guide token and a matte finish; the legend says 'bonds inferred from distance'. Hydrogen-bond guides, used only where a toy or stage asks (sticky water, Six Sides), are dotted hairlines.
2) Visible-midpoint split at (L + r_A − r_B)/2 from A, so each atom's colour takes an equal share of the visible stick.
3) Orders only when supplied: an optional Frame.bondOrders: Uint8Array (1, 2, 3, aromatic = 4).
- Filled from the PubChem JSON order array (already fetched), SDF/MOL parsers, and a PubChem-CID topology sidecar for the curated XYZ examples, with provenance recorded at the curation gate.
- Never perceived silently from XYZ.
- Rendering: at topology time each order-k bond emits k instances with a per-instance offset in the plane of a neighbour atom (CPU cross product). Ring bonds offset inward with the inner line shortened 15% at each end (ChemDraw convention). Aromatic is solid plus a dashed inner line (fragment discard on fract).
- LOD: below ~3 px projected radius the parallel lines collapse to one cylinder thickened by 1 + 0.25(k−1), so order survives zoom-out without aliasing. This is where the brief's 'thickness by order' lives.
4) Strain, in Play only: while C027 deformers act, the bond shader evaluates s = clamp(L_display/L_rest − 1, 0, 0.25)/0.25 from the same deform function. Colour mixes toward a warm tension token and radius thins by (1 − 0.3s); compression tints cool. At zero offset it is exactly off.
5) Motion: arriving bonds grow from atom centres over ~250 ms on the settle token (C010).

**Experience:** Desktop and phone: benzene from PubChem shows its aromatic ring, caffeine its C=O. Tug an atom and its bonds stretch warm and thin like taffy, then boing back (C041 cue). Keyboard: the D2 atom cursor's Shift+arrows tug shows the same effect. Screen reader: 'Bond C1 to C2, double, from PubChem.' Reduced motion: bonds appear without the growth animation, and strain shows as a still per tug step.

**Tech:** R4 bond TSL port: a uvec2 atom-pair attribute plus a per-instance offset vec3 and a flags byte; TSL fract and Discard; math@0.1.0 vec3.cross/normalize into scratch for the offset planes; ring detection by a small DFS/SSSR on the CPU; PubChem PUG JSON bonds.order; bond grow-in on math/time springs.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R4 (bond port), R3/C027 (offsets for strain)

**v9 slice:**

- Keep PubChem orders in the Frame.
- Add SDF/MOL parsing of orders.
- Add the curated sidecars.
- Show the provenance legend text.
- Draw orders in the CPU Illustrate/SVG renderer (landing previews and cards).
The 3D provenance, split and order styling waits for R4 (no new GLSL).

**WebGL2 fallback:** Identical: instances, attributes and discard all run on the WebGL2 backend.

**Where in code:** packages/scene/src/bondImpostor.ts (two-tone split, line ~219); Bonds.tsx; bondTopology.ts (source vs infer modes); packages/ui/src/molecules/pubchemLoad.ts (bonds.order typed at :65, dropped at ~121-145); packages/core Frame type; packages/parsers; packages/ui/src/gallery/studentCollection.ts (sidecars); tools/build-student-previews.mjs

**Risks:** XYZ and LAMMPS carry no orders, so most large scenes won't show them. Offset planes are ambiguous for linear chains, where it falls back to the camera-facing perpendicular. Triple bonds triple the bond instances. Desaturating inferred bonds changes the look of most scenes and needs art-direction sign-off.

**Honesty:** Orders appear only when a named source supplies them, and the legend names that source. Inferred bonds look lighter and say so. The strain colour is labelled illustrative ('stretch, not strain energy'), lives only in the fun layer and is excluded from export.

**Judges:**

- E 4/keep: Showing bond provenance and keeping PubChem bond orders (which Lupi currently throws away) fixes data correctness. It rides the mandatory R4 port with pair attributes and flags. *Improve:* Cap multi-bond instance counts on large scenes, and fall back to the camera-facing perpendicular for linear chains.
- P 2/keep: Visible bond provenance and orders help learners, and strain colour gives Play a little tension feedback. Mostly not play. *Improve:* Tie the strain colour to tug and Pop-It.
- A 5/champion: Bonds are half of every small-molecule image. A split at the visible midpoint, ChemDraw-style inner lines, collapse to thicker cylinders at small pixel radius, and visibly lighter inferred bonds make them read correctly and honestly. *Improve:* Show strain only in Play, with tension and compression tokens that can't be mistaken for element colours. Grow arriving bonds from atom centres on the settle token.
- Pr 5/keep: It fixes a contract-level honesty gap. Inferred bonds look identical to source bonds today, and pubchemLoad reads bond orders and then discards them (verified). It also gives students the double bonds they expect. *Improve:* Ship the v9 slice now: keep the orders and add the provenance legend.
- M 3/keep: Provenance by weight and dash rather than colour alone helps colour-blind users. *Improve:* Verify that inferred and source bonds stay distinguishable in Clear and under forced-colors.

<a id="r2-signature-and-moonshots-05"></a>
## Etched Type: label typography for the R8 glyph shim
`R2-signature-and-moonshots-05` · system · effort M · judges mean **3.4** (E4 P2 A4 Pr3 M4; keep 5) · self-scored fun 1 / visual 3 · perf improves

> Use the forced troika-to-glyph rewrite to give Lupi one label typography. Crisp MSDF tags, tabular readouts and titles sit at fixed screen sizes with plate-coloured halos. They are placed off the atom, dim honestly when occluded, have a DOM mirror, and never shatter data.

**Framing:** capability->problem

**Builds on:** C009 + C027 + C056 + C038 + C024 (new: the typography round 1 never specified)

**Problem:** troika Text breaks under WebGPU. Text is used in 5 files and Html in 3, and the R8 shim must replace them anyway. Today's labels have no typographic spec: sizes scale with distance, drop shadows vary, labels can cover the atom they name, occluded labels look the same as visible ones, and KnowledgeLabelsLayer re-renders about 20 times a second while idle. Nothing on screen tells a screen reader what a 3D label says.

**Solution:**

The <LupiText> spec:
1) Faces, baked with the glyph CLI to MSDF .font.glb and subset with --unicodes (Latin basic, digits, °, Å, ±, −, ·, ×, sub/superscript digits):
- Inter (OFL) for tags, close to the DOM's system-ui.
- IBM Plex Mono (OFL) for tabular readouts.
- A serif (Source Serif 4, OFL) only for titles in capture and end cards; the DOM keeps Georgia.
2) Three roles:
- Tag: 'O3', or an annotation.
- Readout: '1.43 Å', '104.5°'.
- Title: a molecule name.
3) Size in CSS px, constant on screen: Tag 12, Readout 11, Title 20-28 (capture only). Clamped to 10-16 while pinching, rendered at DPR, and never scaled by distance. The base follows the OS text-size preference through the rem baseline.
4) Contrast: glyph's MSDF outline effect as a 2 px halo in the active plate token, with no drop shadows; ≥4.5:1 is checked in goldens.
5) Placement: anchored at the atom's projected upper-right tangent (0.7 × projected radius at 45°), mirrored to upper-left near the right screen edge.
- Greedy screen-grid collision with priority selection > annotation > measurement > knowledge.
- A hairline leader appears when a label is displaced more than one radius.
- Labels follow display offsets through the C027 CPU twin.
6) Honest occlusion: labels draw on top but dim to 40% when their atom is hidden, from a C009 ID-buffer query at 10 Hz.
7) Motion: enter on the settle token (opacity plus a 4 px rise, ~180 ms), exit in ~90 ms, never bounce.
8) Accessibility: every visible label is mirrored in an offscreen DOM list (aria-live polite for new ones). Under forced-colors the labels become DOM Html in system colours.
9) Splitting is for titles only (Condense end cards, Six Sides stage titles), via split(): glyphs become particles, then condense. Tags never split.
10) Fallback: canvas sprites that load the same woff2 subset through FontFace, so metrics match.
11) Budget: at most ~200 live labels, a layout job at 20 fps (R7), picks only on demand.

**Experience:** Desktop: hover an atom and 'O3' settles beside it, crisp at any zoom. A measurement readout in tabular mono doesn't jitter as its digits change. Phone: 12 px tags never sit under your thumb and flip sides at the screen edge. Occluded labels fade, so you know the atom is behind. Keyboard: the D2 atom cursor moves between the same labels. Screen reader: it reads the DOM mirror ('Oxygen 3, bonded to C2 and H7'). Reduced motion: labels appear instantly.

**Tech:** @pmndrs/glyph 0.1.0 (pre-1.0; peers three ≥0.185 and fiber ≥10.0.0-alpha.4; runs on WebGPURenderer including its WebGL2 backend, not on classic WebGLRenderer): Text/TextGroup, MSDF with outline effect, `glyph bake --unicodes`. Text.breakApart() in 0.1.0 is renamed split() on main (PR #239), so the API is version-dependent. Canvas-sprite fallback; C009 RGBA8 ID readback; scheduler per-job fps.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R8 (text shim), R7 (label job fps), R3 (ID target for occlusion)

**v9 slice:** The spec itself, the DOM mirror list, the CPU placement and collision algorithm (applied to today's drei Text/Html), the halo tokens, and the 20 fps label cadence fix ship on v9. Glyph rendering waits for v10.

**WebGL2 fallback:** glyph runs on WebGPURenderer's WebGL2 backend; canvas sprites with identical metrics are the second fallback.

**Where in code:** packages/ui/src/KnowledgeLabelsLayer.tsx; AnnotationsLayer.tsx; MeasurementLayer.tsx; SpatialAnchor.tsx; xr/XRControlPanel.tsx; AtomInfoHUD.tsx (Html); store.ts (annotation 'glyph' mode comment at ~84); LabelPerfHUD.tsx

**Risks:** glyph is weeks old and its API renamed between versions. Baked font assets add bytes (subset size unmeasured). Inter differs from system-ui outside Apple devices. Occlusion dimming depends on the C009 ID target landing first.

**Honesty:** Labels are readouts: values never animate, tags never shatter, and occluded labels dim rather than pretend to be visible. Title splitting is decoration in capture and end cards only. Whether labels appear in deterministic export is a V2 profile decision; they are never part of the fun layer.

**Judges:**

- E 4/keep: It uses the forced troika-to-glyph rewrite (R8) to set one typography, with CPU placement and collision in a 20 fps label job and a DOM mirror. glyph is pre-1.0 and its font asset sizes are unmeasured. *Improve:* Ship the placement algorithm on today's labels first, and keep canvas sprites with identical metrics as the fallback.
- P 2/keep: R8 forces the label rewrite anyway. Crisp labels help, but there's no play here. *Improve:* Keep the rule that data labels never shatter.
- A 4/keep: Restrained typography: constant screen size, a halo in the plate colour, placement on the upper-right tangent, dimming when occluded, no bounce, and data labels never shattered. But Inter, Plex Mono and Source Serif plus Georgia in the DOM is one serif too many. *Improve:* Use one serif across DOM, canvas and capture. Keep Plex Mono for tabular readouts.
- Pr 3/keep: It rides the forced R8 rewrite, and writing the typography spec now costs little. *Improve:* Apply the placement algorithm on v9 first.
- M 4/keep: A DOM mirror of labels for screen readers, fixed screen sizes, contrast halos and a 20 fps cadence. *Improve:* Scale labels with the user's root font size (text-resize).

<a id="r2-signature-and-moonshots-06"></a>
## Ink and Light: one Illustrate renderer on CPU and GPU, and the Ink-to-Light arrival
`R2-signature-and-moonshots-06` · look · effort L · judges mean **4.0** (E4 P3 A5 Pr4 M4; champion 1, keep 4) · self-scored fun 3 / visual 5 · perf improves

> Make Illustrate the print voice with two calibrated engines. A pure-TypeScript SVG renderer makes the landing previews, link cards, Daily silhouettes, stickers and no-GPU fallback on v9 today; the TSL Look matches it in the viewer. A tapped ink tile then becomes the molecule as the light comes on.

**Framing:** problem->solution

**Builds on:** C049 + C106 + C088 + C105 + C114 + C016 + C048 + C009

**Problem:**

Round 1 named Illustrate (C049) the strongest signature voice, but outside the app Lupi has no renderer:
- Landing previews are radial-gradient SVGs in a different palette.
- Every link unfurls with og-lupi.png.
- Cards, the Daily silhouette, stickers and posters all assume a GPU capture service (R9, months away).
- A device with no WebGL shows only text.
- The D1 match frame can't be exact: the preview projection is an ad hoc linear map (px = x·0.94 + z·0.34) rather than a camera.

**Solution:**

1) CPU engine: packages/core/src/illustrate/, pure TypeScript with no DOM.
- Input: atoms, bonds (with provenance and order), a real named camera ('specimen-oblique', orthographic) and tokens. Output: an SVG string.
- Painter's order and flat fills from the Specimen palette lifted in OKLCH to pastels.
- Per-circle ink width = base + k × the depth gap to the nearest farther overlapping neighbour: QuteMol/Goodsell depth-discontinuity lines, drawn with the classic halo-stroke trick.
- Interior shade from the same baked directional AO bytes as the viewer (Contact).
- Bonds are ink capsules, and orders use the Bond Grammar strokes.
- Above ~5k atoms, far-LOD cluster summary circles.
- No RNG, so the SVG is byte-testable.
2) Its uses:
- tools/build-student-previews.mjs regenerates every preview.
- The Worker's /view/:slug card: saved-view coordinates and camera go to SVG, then resvg-wasm renders a 1200×630 PNG, with no client upload or new storage (C106's v9 path); gallery sources only, falling back to og-lupi.png for private uploads.
- Daily silhouettes: an ink-only pass (C088).
- The no-GPU fallback plate (Designed States).
- Sticker and plotter cut files (C105, C114): already vector.
3) GPU engine: the TSL Illustrate Look.
- Ignore-light pastel shading plus baked-AO shading, with no screen-space AO, so it is stable while spinning.
- Ink from C009's RGBA8-packed ID target plus depth: a 3×3 kernel marks ID changes, and width scales with the depth gap (textureGather where available).
- Depth-only edges on GL2 if the ID MRT is unavailable.
4) Calibration: goldens render one pose through both engines (resvg raster vs GPU raster), compared with FLIP and an ink-width probe; one token set tunes both.
5) Ink-to-Light, the signature transition:
- After a tile tap, the viewer's first frame renders Illustrate at the tile's exact pose (the builder now uses the same named camera).
- Then the light comes on: a C048 two-look blend from Illustrate to Specimen over ~450 ms on the settle token. Ink width goes to 0, flat shading becomes lit, and the tile background becomes the plate.
- The edge pass is then swapped out of the prewarmed pipeline graph, so it costs nothing afterwards.
- It plays on the first open per session only, and any touch completes it.

**Experience:** Phone: the tile you tapped becomes the molecule with no colour or pose jump; the ink fades as the light rises. Your saved link unfurls in chats as the same ink drawing, at the angle you saved. Desktop: posters and stickers look like the landing. Keyboard: Enter on a tile runs the same sequence. Screen reader: the preview SVG keeps its <title>/<desc>, and the viewer announces 'Caffeine, Specimen look'. Reduced motion: a single crossfade between the ink still and the lit still.

**Tech:** A dependency-free TS SVG emitter in packages/core; math@0.1.0 mat4 (lookAt, orthographic ZO into scratch) for the named camera; @resvg/resvg-wasm in the Cloudflare Worker (Worker size and CPU limits unverified; Satori not needed because the SVG is ours); TSL mrt with an RGBA8-packed ID (C009), textureGather (r185), fwidth; a C048 uniform blend with If(); compileAsync prewarm of both graphs.

**Backend:** mixed

**Rides (v10 requirements):** R3 (ID/normal outputs), R6 (edge pass and graph swap). Cards do not need R9.

**v9 slice:** The whole CPU engine ships on v9 with zero GLSL: previews, Worker cards via resvg-wasm, Daily silhouettes, fallback plates and sticker SVGs. The in-viewer Look and Ink-to-Light wait for R3 and R6.

**WebGL2 fallback:** The Illustrate Look on GL2 uses depth-only edges if the RGBA8 ID MRT fails. Ink-to-Light is the same uniform blend on both backends.

**Where in code:** tools/build-student-previews.mjs (projection at ~39-56, gradients at ~75-83); apps/web/public/learn/*.svg; apps/mcp-worker/src/index.ts (social HTML ~2569, DEFAULT_SOCIAL_IMAGE); packages/ui/src/landing/MoleculeWall.tsx; RendererFallback.tsx; sceneLooks.ts ('paper' becomes Illustrate); postprocess/ (moves to useRenderPipeline)

**Risks:** resvg-wasm size and CPU inside a Worker are unverified. Large molecules must be summarised. The CPU-to-GPU match is approximate (analytic vs screen-space ink). The arrival blend must never delay the first interaction, which is why a touch completes it. Private uploads can't get server cards without storage.

**Honesty:** Illustrate draws real coordinates at the saved pose. Cards carry name, formula, source and 'illustration' in the alt text, and the ink never implies a surface that isn't in the data. Cards and stickers are illustrative outputs, not MCP artifacts.

**Judges:**

- E 4/keep: A pure-TS Illustrate SVG engine in core feeds previews, cards, Daily silhouettes, stickers and the no-GPU fallback on v9 with no renderer cost. The TSL look reuses the ID and depth edges. resvg-wasm Worker limits are unverified. *Improve:* Make it the single projector for capture-05/06 and flagship-02. Keep Ink-to-Light a two-look uniform blend only.
- P 3/keep: The Ink-to-Light arrival is a nice seam, and the CPU ink renderer powers cards, stamps and the Notebook. *Improve:* Use it for the Notebook stamps first.
- A 5/champion: The signature. One Illustrate voice on CPU (previews, cards, fallbacks, stickers) and on GPU, and an Ink-to-Light arrival where the ink fades as the light comes on. It solves the match frame by making the 3D start as the drawing. *Improve:* Host fm-02's pose manifest and dolly. Add calibration goldens between the two engines, and let a touch complete the arrival instantly.
- Pr 4/keep: The CPU Illustrate engine powers cards, /m pages, Daily silhouettes, stamps, designed states and the no-GPU fallback: acquisition infrastructure on v9. It is effort L, and resvg-wasm's Worker limits are unverified. It hosts flagship-02. *Improve:* Build the CPU half within capture-05, and the TSL half after R6.
- M 4/keep: The CPU SVG engine is the no-GPU fallback and the card engine at once, on v9. *Improve:* Cap atom counts, give SVGs accessible names, and match Clear's palette.

<a id="r2-signature-and-moonshots-07"></a>
## Condense: the logo in motion
`R2-signature-and-moonshots-07` · system · effort M · judges mean **3.6** (E3 P3 A5 Pr4 M3; champion 1, keep 2, merge 2) · self-scored fun 4 / visual 4 · perf neutral

> Turn C030's condensation into Lupi's motion identity. One seeded cloud → gather → settle → click grammar, built from C003 spring tokens and exported identically to TSL, CSS linear() and SVG, is reused by arrival, switching, search, /scan, embeds, loading and loop end cards. The brand's lupine raceme is redrawn as a mark that condenses.

**Framing:** problem->solution

**Builds on:** C030 + C003 + C118 + C109 + C103 + C088 + C017 + C067 + C041

**Problem:**

C030's condensation was a favourite arrival, but it was pitched as one effect. Without a spec, each surface times its own motion:
- gistEngine eases at EASE = 0.06 per frame.
- /scan swirls on its own.
- The switcher morph, embed wake, share-clip end cards and loading spinners each invent timing.
- DOM chrome uses default CSS ease curves unrelated to the 3D springs.
- lib/spring.ts is a fourth spring style.
- The brand mark is a static PNG of a lupine flower.

**Solution:**

1) Grammar: cloud → gather → settle → click, with release as the reverse for bursts and dissolves.
- Tokens come from the C003 kernel: gather (critically damped, ~280 ms response), settle (ζ≈0.7, ~3% overshoot, ~180 ms), click (a terminal detent plus an optional C041 tick).
- Stagger runs centre-out by normalised distance from the centroid, with a total spread of 120 ms or less.
- The cloud is the molecule's own bounding ellipsoid ×2.2, sampled with mulberry32 seeded by the molecule id, so each molecule has its own condensation, identical on every device.
- Total time ≤600 ms, and any input completes it instantly by springing to target.
2) One curve in three media, from one source:
- math/time spring parameters for 3D (uniforms).
- CSS linear() easing strings sampled at build time for DOM and SVG.
- Web Animations keyframes for SVG dots.
The landing tile's dots (SVG, on touch only, so zero canvas), the viewer and the chrome sheets all move with one hand.
3) Reuse map with budgets: viewer arrival on the first open per session; the switcher's scatter-and-condense labelled 'transition' (C118 rework); the search stage's gist candy; /scan Made-Of; embed wake (C109); loop-clip end cards (C103); the Daily reveal (C088); loading progress (Designed States). Nowhere else, so it stays a signature rather than a tic.
4) The mark: the lupine raceme in og-lupi.png is literally a column of ovals. Redraw it as a 9-sphere mark in the Specimen palette (SVG). It condenses whenever no molecule is known yet (app-shell load, 404, end cards). It is clearly a logo, not presented as a molecule.
5) Sound: an optional soft gather swell and click tick (C041), captioned, and silent until the first gesture.

**Experience:**

Every arrival feels authored by one hand:
- On the landing, touching a tile gathers its dots toward the molecule (SVG).
- The viewer condenses.
- Switching scatters and condenses.
- Loops end on the molecule condensing, then the mark.
Keyboard: Space or Escape completes any condensation. Screen reader: announces 'Caffeine loaded' at the click, never during the motion. Reduced motion: one still per action, a 150 ms crossfade from the cloud still to the final still, never a loop.

**Tech:** math@0.1.0 math/time spring.update, fromResponse and easings; math/random mulberry32 (low 16 bits of the seed matter); a build-time sampler that emits CSS linear() (Chrome 113+, Firefox 112+, Safari 17.2+); the Web Animations API; TSL hash(instanceIndex) plus a progress uniform in the R3 positionNode; v9 uses the existing uProgress interpolation with a seeded gas-cloud 'from' frame.

**Backend:** mixed

**Rides (v10 requirements):** R3 (per-atom stagger in positionNode), R7 (demand, invalidate until settled)

**v9 slice:** Token export (TS and CSS linear()), the SVG mark, the landing-tile SVG gather on touch, and the viewer entrance on the existing uProgress hook without stagger (zero new GLSL).

**WebGL2 fallback:** Identical: closed-form and uniform-driven on both backends.

**Where in code:** packages/ui/src/lib/spring.ts (to retire); CameraFocus.tsx (per-frame lerps); scan/gist/gistEngine.ts (EASE); switcher/; landing/MoleculeWall.tsx and student-home.css transitions; packages/scene/src/InterpolatedAtoms.tsx and interpolation.ts (uProgress); apps/web/public/og-lupi.png (becomes an SVG mark)

**Risks:** Overuse turns a signature into a tic, hence the capped reuse map and the first-open rule. The CSS linear() sampling resolution must capture the overshoot. The scatter must never read as a chemical reaction, which is why it is labelled a transition. The mark redraw needs the brand owner's approval.

**Honesty:** Condensation is labelled an arrival transition, never how molecules form. It is a display offset relaxing to zero (source atoms never move), reduced motion gets stills, and export excludes it.

**Judges:**

- E 3/keep: Art-direction glue over port-02's mechanism. Exporting the tokens to CSS linear() and SVG gives landing tiles and loaders the same motif. The risk is overuse. *Improve:* Generate every export from C003's token table, and enforce the capped reuse map.
- P 3/merge: The third spec of the condense motion. The CSS linear() export to the DOM is a nice touch for brand coherence. Host: R2-port-as-toy-engine-02. *Improve:* Merge, and cap reuse so the motif doesn't become a tic.
- A 5/champion: Motion identity with a capped reuse map, one curve in three media, and the lupine raceme redrawn as a 9-sphere mark (the og-lupi.png mark is indeed a column of ovals). But its constants disagree with fm-04 and port-02. *Improve:* Host fm-04 and port-02, and sign one spec. Gather inward to the molecule, but order the stagger from the bottom of the screen up: lupine racemes open from the base upward, which ties the mark to every molecule.
- Pr 4/keep: A motion identity exported identically to CSS, SVG and TSL, with a capped reuse map. The scatter must never read as a reaction. *Improve:* Implement it through Keyframe Relay.
- M 3/merge: Merge into FM-04. The condense grammar is the router's content. *Improve:* Keep the capped reuse map, and use a crossfade under reduced motion everywhere.

<a id="r2-signature-and-moonshots-08"></a>
## Designed States: every non-happy path is a specimen plate
`R2-signature-and-moonshots-08` · foundation · effort M · judges mean **4.0** (E4 P3 A4 Pr4 M5; champion 1, keep 4) · self-scored fun 2 / visual 3 · perf improves

> Design loading, empty, error, no-GPU, lite, device-lost, battery-saver and huge-file states in the house language: plate, ink and condense. Honest progress replaces spinners, a device with no WebGL can still rotate the molecule in ink, and a lost GPU leaves the picture on screen while the viewer restores.

**Framing:** problem->solution

**Builds on:** C016 + C030 + C049 + C004 + C014 (fills round 1's device-loss gap and the designed-states gap)

**Problem:**

Non-happy paths are undesigned:
- The viewer shows a loading overlay, then the canvas pops in.
- RendererFallback shows the word 'Lupi' and text on a blue-black gradient that matches nothing.
- Only GPU Studio sets renderer.onDeviceLost; the main viewer has no device-loss handling, so under v10 a lost GPUDevice leaves a blank canvas.
- The ~13% of visitors on the WebGL2 backend are never told what they're missing.
- A Low Power iPhone looks 'slow' rather than intentionally calm.
- Parse errors show text only.

**Solution:**

A state machine using one plate language (tokens, the Illustrate CPU renderer, Condense):
1) Arriving (route or chunk loading): the Illustrate SVG of the requested molecule (the curated preview, or one CPU-rendered from parsed atoms, or the mark if unknown) sits exactly where the canvas will be, so there is no black frame.
2) Honest progress: plate dots condense in proportion to real stages (bytes received against content-length, then parse, then bonds). With an unknown length, the mark breathes. Under reduced motion it shows text such as 'Loading caffeine: step 2 of 3'.
3) First frame: crossfade from SVG to canvas on the first rendered frame, or Ink-to-Light where enabled.
4) Empty: the plate with a dashed drop outline and three suggestion chips with Illustrate thumbnails.
5) Parse error: the atoms that did parse, drawn in ink, a hairline where it failed, the file line number, and 'Open another' or 'Try as XYZ'.
6) No 3D graphics: the CPU Illustrate plate with arrow-key or drag rotation for up to ~2k atoms (the SVG is re-rendered per step, one still per action) plus the element legend. This is a working lite viewer without WebGL, labelled 'Drawing without 3D graphics'.
7) Lite graphics (WebGL2 backend): a quiet chip that opens a sheet naming exactly which [GPU] extras are unavailable. It never nags.
8) Device lost: renderer.onDeviceLost (present in r186; the WebGL backend routes context loss to it too) immediately shows the Illustrate plate at the current camera pose, which is CPU-side. The Canvas remounts and restores Look, camera and selection; toy offsets reset because they are fun layer. A message appears only if the restore takes more than 1 s.
9) Still mode: when C004 detects a locked 33.3 ms cadence, toys become one still per action and a chip explains 'Battery saver: stills'.
10) Huge file: a preflight atom count gives '12M atoms: opening in large mode', with a cluster-summary plate.
Every state has aria-live copy, keyboard actions and a golden screenshot.

**Experience:** Phone on a slow connection: the molecule's ink drawing forms as bytes arrive, then the light comes on. Old Android without WebGL: can still turn caffeine in ink with arrow buttons. A laptop GPU reset: the picture stays, then carries on. Keyboard: every state has a focused primary action. Screen reader: 'Loading caffeine, step 2 of 3', 'Graphics restarted'. Reduced motion: text and stills only.

**Tech:** The CPU Illustrate renderer (Ink and Light); fetch ReadableStream progress; three r186 Renderer.onDeviceLost (verified in the 0.186.1 build: both backends call it); an R3F v10 Canvas remount key; state.webGPUSupported for the Lite chip; C004 cadence sampling; aria-live regions.

**Backend:** DOM/CPU

**Rides (v10 requirements):** R12 (renderer factory, device loss), R7 (cadence, demand)

**v9 slice:** States 1, 2, 4, 5, 6 and 10 ship on v9 as DOM/SVG. On v9, webglcontextlost/restored handling stands in for state 8.

**WebGL2 fallback:** The Lite chip is the GL2 state. Context loss on the WebGL2 backend reaches the same onDeviceLost path.

**Where in code:** packages/ui/src/RendererFallback.tsx; CanvasErrorBoundary.tsx; viewer/ViewerCanvas.tsx; viewer/loadGuard.ts; loadMoleculeSource.ts; store.ts (setLoading, setError); renderCapability.ts; gpu-studio/runtime.ts (onDeviceLost pattern to generalise)

**Risks:** CPU SVG rotation of ~2k atoms per step is fine, but continuous drag may stutter on old phones (cap the count, rotate by step). Honest progress needs content-length. Remounting after device loss may leak until the renderer-unmount fix (#3926) lands.

**Honesty:** Progress shows real stages only. The lite plate is labelled a drawing and never pretends to be the 3D view. States are chrome, outside export.

**Judges:**

- E 4/keep: No black frame, honest progress and a no-WebGL ink fallback all ship on v9 as DOM. onDeviceLost exists on both r186 backends. Much of its value is removing the dead splash. *Improve:* Share the device-lost state machine with port-07, and rotate the CPU fallback by step on old phones.
- P 3/keep: A spinnable ink molecule while loading and on devices with no GPU means there is never dead time, which is good for the first minute. *Improve:* Share the relay stage with flagship-03.
- A 4/keep: Every non-happy path becomes a specimen plate. Honest progress shows as plate dots condensing, and a lost GPU leaves the picture on screen. *Improve:* Make it one plate component shared with fm-03's relay and port-07's loss poster.
- Pr 4/keep: Honest 'lite' messaging for the ~13% on WebGL2, no black frames, and ink rotation even with no WebGL at all. *Improve:* Share the arriving state with Relay Baton, and the loss state with Phoenix.
- M 5/champion: Designed loading, empty, error, no-GPU, lite, device-lost, battery-saver and huge-file states are graceful degrade made visible. No black frames, honest progress, ink rotation without WebGL and an honest Lite chip are the floor every old device lands on. *Improve:* Share the device-lost visual with PT-07. Reduced motion shows static progress, and every state has a focusable action and one announcement.

<a id="r2-signature-and-moonshots-09"></a>
## Clear: the accessible Look, with a palette solved per molecule
`R2-signature-and-moonshots-09` · look · effort M · judges mean **3.6** (E4 P2 A4 Pr3 M5; champion 1, keep 4) · self-scored fun 1 / visual 3 · perf improves

> One high-contrast, colour-blind-safe Look combines round 1's four partial fixes (C045, C063, C056, C049). Element letters sit on the atoms, ink edges separate figure from ground, the haze is gone, and the palette is solved for the elements actually present so they stay distinct under protan, deutan and tritan vision.

**Framing:** problem->solution

**Builds on:** C045 + C063 + C056 + C049 + C046

**Problem:** Element identity rides almost entirely on colour. CPK pairs such as O/Cl and N/O collapse under deuteranopia and protanopia. Fog lowers contrast, and bloom, DOF and vignette hurt low vision. There is no high-contrast mode and no response to prefers-contrast or forced-colors. Round 1 split the fix into four ideas: grades (C045), Okabe-Ito presets (C063), letter decals (C056) and ink (C049).

**Solution:**

1) A palette solved per molecule: only the elements present need distinguishing.
- At load, for that set (caffeine: C, H, N, O), pick one colour per element from 3-5 curated variants in its CPK hue family, plus Okabe-Ito-derived anchors.
- The pick maximises the minimum pairwise OKLab distance under normal vision and under Machado et al. (2009) protan, deutan and tritan simulations, subject to ≥3:1 contrast with the plate (WCAG 1.4.11).
- Exhaustive search for up to 8 elements (at most 4^8 combinations, in a worker), greedy beyond that.
- Deterministic, so a molecule always gets the same Clear palette and its legend is stable.
2) Letters: C056 decals are on by default with a pixel-radius LOD, so identity never depends on colour.
3) Ink: Illustrate silhouette edges at 1.5 CSS px or wider.
4) Off: fog, DOF, bloom, vignette, films, animated backdrops and transparency; the filter shell becomes an opaque outline.
5) Plate: a flat plate at the luminance that maximises contrast with the palette, with chrome following through the tokens.
6) Auto-selection: prefers-contrast: more selects Clear. forced-colors: active selects Clear with chrome in system colours, and ink takes the CanvasText colour read from computed style. A manual toggle is always available.
7) Clear is a Look, not a mode, so every toy still works.

**Experience:** A deuteranope opens caffeine and N and O are plainly different and lettered. A teacher on a washed-out projector turns on Clear: crisp ink, letters, no haze. Phone: the letters fade in as you zoom. Keyboard: the Look menu (or a shortcut) toggles it. Screen reader: 'Clear look on: element letters shown, colours adjusted for contrast'. Reduced motion: no change needed; Clear adds no motion.

**Tech:** Machado/Oliveira/Fernandes 2009 CVD matrices in linear RGB; a ~30-line OKLab distance (math/color lacks OKLab); the existing palette DataTexture upload; C056 tiny-sdf atlas decals in the R3 impostor; C049 edges; matchMedia('(prefers-contrast: more)') and '(forced-colors: active)'.

**Backend:** [GPU+GL2]

**Rides (v10 requirements):** R3 (decals, ID for ink), R6 (edge pass)

**v9 slice:** The per-molecule CVD-solved palette upload, the flat plate, post off (the existing 'diagram' path) and prefers-contrast auto-selection all ship on v9 through the palette texture and existing presets. Decals and ink wait for R3 and R6.

**WebGL2 fallback:** Works: the palette is a texture, decals are one texture fetch, and ink falls back to depth-only edges if the ID MRT fails.

**Where in code:** packages/ui/src/coloring/colorSchemes.ts; packages/core/src/elements.ts; sceneLooks.ts; postprocess/presets.ts ('diagram'); store.ts; deviceCapabilities.ts (media queries)

**Risks:** In Clear, O may differ in shade between molecules. Hue families and letters limit the confusion. Scenes with many elements can't satisfy every CVD type, so letters carry them. Forced-colors behaviour over a canvas differs by browser.

**Honesty:** Clear changes colours, never meaning: the legend says 'colours adjusted for contrast', and letters carry identity. It is deterministic, so it is a valid V2 export Look with no fun layer.

**Judges:**

- E 4/keep: A per-molecule CVD-solved palette computed in a worker and uploaded as the existing texture is cheap and ships on v9, with prefers-contrast auto-selection. Decals and ink edges come later with R3 and R6. *Improve:* Use letters to carry the load when there are more than ~8 elements, and add forced-colors tests.
- P 2/keep: A valuable access Look, but not play. *Improve:* Keep it one tap away and never locked.
- A 4/keep: Letters, ink and no haze make the accessible Look a strong graphic Look rather than a penalty mode. But a palette solved per molecule means oxygen changes shade from molecule to molecule. *Improve:* Fix Clear colours for C, H, N and O, and solve only for the other elements present.
- Pr 3/keep: An accessible Look. Solving the palette per molecule means oxygen's shade varies between molecules, which trades against teaching consistency. *Improve:* Always show the letters, so they carry identity.
- M 5/champion: The first real colour-vision and high-contrast answer: a palette solved per molecule under protan, deutan and tritan simulation with at least 3:1 plate contrast, element letters, ink edges and no haze. It is auto-selected by prefers-contrast, and the v9 slice is a texture upload. *Improve:* Auto-select it under forced-colors too (a canvas ignores system colours), and add a Clear golden to SM-10's matrix.

<a id="r2-signature-and-moonshots-10"></a>
## Four Looks, Many Goldens: a capped catalogue and look-parity QA
`R2-signature-and-moonshots-10` · foundation · effort M · judges mean **4.0** (E5 P2 A5 Pr4 M4; champion 2, keep 3) · self-scored fun 1 / visual 3 · perf neutral

> Cap the catalogue at four recognisable Looks (Specimen, Illustrate, Night, Clear) and guard them with perceptual goldens across Look, backend, quality rung and reference molecule. Each golden also runs invariant probes (plate colour, element colour, AO contact, shimmer, ink width, catchlight), so Specimen on an iPhone GL2 fallback provably matches Specimen on a desktop.

**Framing:** problem->solution

**Builds on:** C014 + C001 (look-parity golden set) + C048 + C045 + C066 + C007 + C004

**Problem:**

The port changes nearly everything the look depends on:
- It loses N8AO and BlendFunction variety.
- It splits rendering into two backends.
- It adds quality rungs (render scale with fsr1, matcap LOD).
V2 export baselines are byte-exact per execution class, so they can't serve as look QA. Round 1 produced about 20 Look ideas, and there is no bar to judge them against. Today's four Looks (Studio, Paper, Night, Prism) have no goldens and silently change at 25k atoms.

**Solution:**

1) Catalogue: exactly four Looks.
- Specimen (default; was Studio).
- Illustrate (was Paper; the print voice).
- Night (dark editorial; hosts the C050 highlight glow).
- Clear (accessible).
Prism becomes a Remix rare roll (the C053 pearl). A new Look must replace one, and the C048 Look Pad blends only between these points.
2) Matrix: 4 Looks × 2 backends (the R11 WebGPU SwiftShader lane and the GL2 lane) × 3 rungs (desktop 1.0; phone 0.67 plus fsr1; large-scene/matcap) × 5 references (water, caffeine, C60, graphene ribbon, 1M Cu lattice), each at the named specimen-oblique pose. That is about 120 images nightly, with a subset on each PR.
3) Perceptual metrics: NVIDIA FLIP mean and 99th percentile against references.
4) Invariant probes read from the ID and depth buffers:
- plate colour ΔE against its token;
- element colour at atom centres against the palette under Neutral;
- the AO contact ratio at a known touching pair;
- silhouette shimmer, as FLIP between the frames of a 4-step 0.5° micro-orbit (C007's concern);
- ink width in px (Illustrate, Clear);
- label contrast ≥4.5:1;
- catchlight present on a reference sphere, which checks the rig.
5) References: path-traced prints (Gallery Print, or an offline Cycles render early) for Specimen, and CPU Illustrate rasters for Illustrate.
6) Device lab (C014): the same matrix weekly on a real iPhone (WebGPU and the GL2 fallback), a mid-range Android and a Low Power run.
7) Each PR gets a static HTML contact sheet for art-direction review.

**Experience:** Visitors don't see a feature, just that Lupi looks like Lupi on every device and Looks never switch identity with atom count. The art director reviews one contact sheet per PR instead of a drawer of devices.

**Tech:** Playwright in the R11 lanes (Chromium SwiftShader WebGPU; the GL2 lane via forceWebGL); fixed-size output (R3F v10 Canvas width/height); readRenderTargetPixelsAsync; NVIDIA FLIP (BSD-3); the C009 RGBA8 ID target for the probes; the existing `pnpm verify:render-parity` harness as the host.

**Backend:** mixed

**Rides (v10 requirements):** R11 (dual CI lanes), R9 (fixed-size capture), R6

**v9 slice:** Goldens and probes for today's v9 renderer now, so the port has a 'before' to match. The catalogue reduction ships on v9: Studio becomes Specimen, Paper stays as Illustrate's placeholder until R6, Night stays, Clear-lite is added, and Prism moves to Remix.

**WebGL2 fallback:** GL2 is a first-class lane. Any probe tolerance that differs is documented, never silently loosened.

**Where in code:** tests/ui/; tools/verify-render-parity (pnpm verify:render-parity); playwright.config.mjs; packages/ui/src/sceneLooks.ts (SCENE_LOOKS); sceneRemix.ts

**Risks:** SwiftShader differs from real GPUs in precision and MSAA. FLIP thresholds need tuning. CI minutes grow. Goldens churn during the port unless the v9 'before' set is frozen first.

**Honesty:** Goldens are look QA only. They never replace the byte-exact V2 export baselines and make no performance claims.

**Judges:**

- E 5/champion: Capping the catalogue at four Looks shrinks the variant and prewarm surface. Perceptual goldens across Look × backend × rung × reference, plus invariant probes, are the look-parity net the port was told to have. Freezing a v9 'before' set gives R3 and R6 a target. *Improve:* Freeze the v9 goldens before Phase 1. Document per-lane tolerances, and salvage sig-12's offline Cycles renders as reference images.
- P 2/keep: Capping the catalogue at four Looks, guarded by goldens, protects quality, but slightly shrinks what a player can flip through. *Improve:* Keep Remix rolls varied within the four.
- A 5/champion: It caps the catalogue at four Looks: today's Studio, Paper, Night and Prism become Specimen, Illustrate, Night and Clear, with Prism moving to a rare roll. Invariant probes and a contact sheet per PR guard each Look's identity. This closes round 1's look-parity gap. *Improve:* Freeze the v9 'before' goldens first. Add a motion probe (settle overshoot) and a phone-aspect framing check.
- Pr 4/keep: Scope discipline I endorse: cap the catalogue at four Looks, so any new Look must replace one, and guard the port with goldens. *Improve:* Freeze the v9 'before' goldens first.
- M 4/keep: Goldens across both backends and the phone rung make GL2 a first-class lane. *Improve:* Add forced-colors and prefers-contrast goldens, plus a reduced-motion still per Look.

<a id="r2-signature-and-moonshots-11"></a>
## Moonshot: Crystal Sand, a single-crystal hero
`R2-signature-and-moonshots-11` · moonshot · effort XL · judges mean **2.8** (E2 P4 A4 Pr2 M2; keep 2, park 3) · self-scored fun 5 / visual 5 · perf costs

> On one rock-salt nanocrystal, WebGPU compute turns ~30k atoms into grains you can plough, tip and pour into a dune whose shadow you can see. Heal flies every grain home until the lattice clicks shut. Phones and GL2 get an analytic slump-and-heal on the same display offsets, and even v9 gets a slice.

**Framing:** capability->problem

**Builds on:** C037 + C028 + C030 + C027 + C004 + C014 + C072 + C103

**Problem:** Crystals are the least touchable things in Lupi. Round 1's Crystal Sand (C037) was called potentially the most breathtaking image, but it was parked as XL, WebGPU-only, and degrading to 'a different toy'. The house style needs one image nobody else has: a perfect lattice collapsing into sand and healing to perfect order, lit by the Specimen rig and grounded by its own shadow.

**Solution:**

Gate:
- The gate spike reports impostor cost on a phone and a laptop.
- The C028 ripple has shipped, proving the offset layer.
- The C014 thermal soak shows headroom for a 30 s compute burst on named devices.
The [GPU] tier requires the WebGPU backend, C014 class 'high' and no Low Power Mode.

Scene: a procedural rock-salt nanocube (~30k atoms, Na and Cl in the Specimen palette) on the Contact floor shadow, with matcap-LOD grains.

Simulation (display offsets only; base positions untouched):
- TSL compute with a hand-written fixed-step accumulator in the physics phase (scheduler 0.2.0 has no fixed timestep).
- Gravity, a pointer-capsule force from the finger ray, and floor and bowl bounds.
- Contacts via CountingSort grid binning (cell = grain diameter) with Jacobi PBD position constraints and static/kinetic friction (Macklin et al. 2014 granular model), capped at 16 neighbours.
- A home spring k_home(t) is 0 while playing and ramps for Heal.
- Sleep when a reduction pass finds max grain speed below ε.

Beats:
1) A 'Sand' chip on the hero crystal page.
2) Drag: grains part and tumble with a C041 sand hiss, captioned.
3) Tip: tilt via the shared permission flow, or the ←/→ Tip buttons, pours a dune across the plate; its floor shadow becomes the dune's silhouette.
4) Heal (hold or H): a centre-out stagger on Condense tokens. Grains fly home and the lattice clicks shut as the shadow snaps crisp.
5) Caption: 'Toy physics: atoms don't flow like sand. A real salt grain holds about 10^18 atoms.' It links to 'See a real crystal melt' (the C072 cu_melt run).

Budget:
- The job runs only while grains move and sleeps otherwise.
- Continuous play is capped at 30 s, then freezes (without healing) with 'Tap to keep playing'.
- [GPU]-tier phones are capped at a per-job fps of 30, with C004 render scale.

Degrade below the tier: an analytic slump.
- A worker assigns each atom a heap target on a cone of repose (~33°) at matched packing density. This is the stored-buffer exception, like IK.
- A closed-form fall f(base, target, t) runs with height-ordered delays and a settle-token bounce.
- Heal is the same function reversed.
- Drag is the C028 wake; Tip left or right chooses one of two precomputed heaps.

**Experience:** Desktop: the mouse ploughs trenches, arrow keys tip, and H heals; an Instant Replay 'Heal' loop template (C103) makes the brag clip. Flagship phone: the finger ploughs and a tilt pours. Other phones and GL2: tap Pour and the crystal slumps into a dune; tap Heal and it condenses back. Screen reader: 'Crystal poured into a pile. Heal restores it. Motion is illustrative.' Reduced motion: stills of crystal, then dune, then crystal.

**Tech:** three r186 TSL compute (instancedArray via useBuffers in the @react-three/tsl canary, alpha); CountingSort (r186; its CPU path is too slow here, so [GPU]); atomics for reductions ([GPU]); compileComputeAsync prewarm; scheduler 0.2.0 physics phase with a hand-written accumulator; math/random mulberry32. Precedents: three's webgpu_compute_particles_fluid and holtsetio/flow (MLS-MPM in TSL, MIT). DeviceMotion through the shared permission flow.

**Backend:** [GPU]

**Rides (v10 requirements):** R3 (offset buffer), R7 (physics phase), R12 (requested limits); the analytic slump rides R3 only

**v9 slice:** The analytic slump-and-heal on v9's existing uProgress hook: upload the heap targets as the 'target frame' and spring uProgress there and back. There is no stagger, but also no new GLSL.

**WebGL2 fallback:** The analytic slump plus the C028 wake: no atomics or CountingSort needed, closed form with a CPU twin.

**Where in code:** packages/scene/src/AtomsOptimized.tsx (offsets in the TSL positionNode); InterpolatedAtoms.tsx and interpolation.ts (uProgress v9 slice); the procedural lattice generator in packages/core (a rock-salt two-atom basis may need adding; check); packages/ui/src/gpu-studio/snow-motion.ts (DeviceMotion pattern)

**Risks:**

- Granular PBD needs careful tuning to stay stable.
- Phone fill rate: three's compute examples on an iPhone 12 Pro Max varied roughly threefold with view angle (research digest).
- Thermal load.
- The iPhone storage-buffer limits are unverified.
- The rock-salt generator is unconfirmed.
- Only one hero crystal, so reach is narrow by design.

**Honesty:** Sand is a display-offset toy labelled 'toy physics'. Base positions never change, Heal restores them exactly, export zeroes the offsets, and a real melt run (C072) is one tap away.

**Judges:**

- E 2/park: XL and WebGPU-only, with atomics, CountingSort and granular PBD. The analytic slump degrade is sensible, but the whole thing waits on the gate spike, C014 thermals and a shipped ripple. *Improve:* Revisit after the phone gate spike and C014 thermal data. Ship only the analytic slump as a Touch Field kind if wanted sooner.
- P 4/keep: Ploughing and pouring grains, then healing the lattice shut with a click, is the most tactile toy across both rounds; sand toys are timeless. But it's XL, [GPU] and gated. *Improve:* Fund it as the first moonshot after the gate. Test the v9 analytic slump-and-heal with strangers before building the compute version.
- A 4/keep: The most breathtaking image candidate in the round. Heal on the Condense tokens, with the shadow snapping crisp, is the payoff, and the analytic slump is an honest degrade. *Improve:* Matte grains in the palette with no sparkle. Park it until the gate spike and C014 report.
- Pr 2/park: Effort XL, [GPU] only, with thermal risk, for a desktop demo moment. *Improve:* Revisit after C014 thermal data exists.
- M 2/park: XL and [GPU], with 30 s compute bursts that need thermal headroom. The analytic slump degrade is at least stated. *Improve:* Revisit after the device lab's thermal soak.

<a id="r2-signature-and-moonshots-12"></a>
## Moonshot: Gallery Print, the path tracer as the house look's ground truth
`R2-signature-and-moonshots-12` · moonshot · effort XL · judges mean **2.2** (E2 P2 A3 Pr2 M2; rework 1, park 3, kill 1) · self-scored fun 3 / visual 5 · perf costs

> On WebGPU desktops the shutter develops a path-traced print lit by the exact softbox panels of the Specimen rig. Visitors get a poster worth keeping, and the raster Look gets a physically lit reference to be tuned against. Everywhere else the same button develops a studio raster or an ink print.

**Framing:** capability->problem

**Builds on:** C061 + C060 + C114 + C106 + D4 capture service

**Problem:** C061's path-traced tier was parked as XL beauty with no growth payoff, while the art director keeps asking for a peak image. Separately, once N8AO is gone the house look has no reference: AO strength and environment gains would be tuned by eye on one monitor. Poster tiles also seam under screen-space post (C114's flaw).

**Solution:**

1) Reference role:
- Lights are the SCIENTIFIC_STUDIO_RIG panels as rectangular area lights.
- Materials use the Specimen BRDF: GGX specular, Lambert and clearcoat from the same tokens.
- The floor is a shadow catcher, and the background is the plate gradient.
- References rendered this way tune the raster Specimen (baked AO strength, env gains) through the Look goldens.
- Before v10, an offline Blender Cycles scene built from the xyz and the rig JSON produces the same references.
2) Visitor role, the C060 shutter's 'Develop' on qualifying desktops:
- A primary-hit G-buffer (albedo, normal, depth) is written first.
- Progressive 1 spp per dispatch accumulates into an RGBA16F storage texture.
- Analytic ray-sphere tests for atoms, and ray-capsule tests for bonds including order offsets.
- A binned-SAH BVH built on the CPU in a worker, in a storage buffer.
- Next-event estimation to the rectangle panels, at most 3 bounces with Russian roulette, and a low-discrepancy sequence.
- Optional DOF focus from the C060 one-pixel depth read.
- An edge-avoiding à-trous denoise guided by the G-buffer at the end.
- Any touch pauses and onIdle resumes. It stops at a sample budget or variance threshold, then sleeps.
- Dispatches stay small to avoid GPU watchdog resets.
3) Output goes through the capture service as a PNG at screen, 2K or 4K (up to maxTextureDimension). Path-traced pixels are independent, so tiles don't seam; only the denoiser needs a kernel-radius overlap. That fixes C114's poster-seam problem.
4) Tiering and truth:
- The button reads 'Develop' everywhere, and the result card says truthfully 'light-traced', 'studio render' or 'ink print'.
- A lazy chunk: zero cost unless pressed.
- Gate: the gate spike, C014 class 'desktop-high', adapter storage limits, and a non-mobile device.

**Experience:** Desktop: frame the molecule and press Develop (or P). The image visibly clears over seconds behind a progress ring, then download or share it. Phone and GL2: Develop runs the bounded C060 raster accumulation (jittered AA, baked AO, floor shadow) and hands a crisp still to the share sheet. No GPU: an Illustrate SVG print. Keyboard: P develops and Esc stops. Screen reader: 'Developing, 40 percent… print ready'. Reduced motion: the progress ring becomes a percentage and the image appears when done.

**Tech:** TSL compute with storage buffers and a storage texture ([GPU]); CountingSort as a uniform-grid alternative to the BVH; readRenderTargetPixelsAsync; scheduler onIdle. three ships no sphere path tracer, so this is hand-written. Precedents: wwwtyro/speck-pbr (MIT; WebGPU path-traced molecules with Illustration and Newspaper presets) and Mol*'s progressive illumination mode.

**Backend:** [GPU]

**Rides (v10 requirements):** R3 (shared atom buffers), R7 (onIdle), R9 (capture), R12 (requested limits)

**v9 slice:** An offline reference-render script (Cycles from xyz plus the rig JSON) to tune today's look. It is not user-facing; there is no visitor slice on v9.

**WebGL2 fallback:** The same Develop button runs the C060 raster accumulation. There is no path tracing on GL2 or phones.

**Where in code:** packages/ui/src/studioEnvironment.ts (rig panels become area lights); ExportManager.tsx and export/ (capture); packages/ui/src/gpu-studio/ (precedent for lazy WebGPU-only features); a new lazy packages/renderer/src/pathtrace/

**Risks:** XL and WebGPU-only. Long dispatches risk GPU watchdog resets. Denoise quality is uncertain, 4K accumulation uses real memory, and convergence time is unmeasured. The raster Look may never fully match its reference, so tolerances must be art-directed.

**Honesty:** The print is labelled an artistic render of atoms as spheres at display radii under studio lights. It is an illustrative output, never an MCP artifact, and the fun layer is zeroed before developing.

**Judges:**

- E 2/kill: A hand-written WebGPU sphere path tracer with denoising and watchdog risk is XL for a desktop-only poster. The raster Specimen Camera already covers the visitor role. *Improve:* Salvage only the offline Cycles reference renders into sig-10's goldens.
- P 2/park: A path-traced print is a beautiful poster, but there's nothing to play with, and it is XL and desktop-only. *Improve:* Keep the offline Cycles reference for art direction only.
- A 3/rework: A path-traced reference lit by the exact rig panels is valuable for tuning the raster look, but the in-browser visitor path tracer is XL and WebGPU-only. *Improve:* Ship the offline Cycles reference script now as look-development ground truth for sig-10, and park the visitor path tracer.
- Pr 2/park: Effort XL, with no visitor-facing slice on v9. *Improve:* Keep the offline Cycles renders for internal reference only.
- M 2/park: XL, desktop [GPU]; irrelevant to phones, though it degrades to raster. *Improve:* Offline reference only until the device lab reports.

<a id="r2-signature-and-moonshots-13"></a>
## Moonshot: Six Sides, Powers of Ten from water to a snowflake
`R2-signature-and-moonshots-13` · moonshot · effort L · judges mean **3.6** (E3 P4 A4 Pr4 M3; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf neutral

> A staged Powers-of-Ten journey that starts from the water molecule on Lupi's home page and answers 'why do snowflakes have six sides?': one water molecule, a hexagonal ring, a real ice-Ih block viewed down its c-axis, tiled ice, a crystal habit, then a snowflake you grow and keep.

**Framing:** problem->solution

**Builds on:** C082 + C095 + C078 + C021 + C030 + C105 + C106 + C088

**Problem:**

C082 split the judges:
- A continuous pinch across many orders of magnitude needs camera-relative positions and log depth (engineer).
- It is a vestibular stress test (mobile judge).
- It had no story (the product steward wanted a journey from water).
- The art director still wants the Powers-of-Ten moment Lupi can own.

**Solution:**

Discrete stages, each with its own origin, near and far planes, and camera, so there are no precision problems. Counters are computed; atoms are drawn only where there are coordinates.
- S0, 0.3 nm: one water molecule (the home model).
- S1, ~1 nm: six waters in an ice-Ih hexagonal ring, cut from a GenIce2 cell. Hydrogen bonds are dotted inferred guides (Bond Grammar). 'Six molecules make the ring.'
- S2, ~5 nm: a real ice-Ih block, ~3.8k molecules and ~11.5k atoms at 30.7 molecules/nm³, generated offline by GenIce2 (MIT; hydrogen-disordered, obeying the ice rules). A c-axis detent: look down it and the hexagonal channels appear. Label: 'Ice Ih model; hydrogen positions are one valid arrangement (GenIce2).'
- S3, ~50 nm: the S2 block tiled as instances plus far-LOD cluster splats (R5). 'Tiled copies of the 5 nm block.'
- S4, ~10 µm: a DOM/SVG Illustrate plate of a hexagonal-prism ice crystal (its habit), with a computed molecule count.
- S5, ~1 mm: a snowflake grown in a worker by Reiter's (2005) hexagonal cellular model, seeded, drawn in Illustrate ink. Two sliders map qualitatively from plate to dendrite, in the spirit of the Nakaya diagram. 'Keep' turns it into a sticker or card (C105, C106).

Transitions:
- A DOM square frame (after the Eames film) stays fixed on screen.
- 'Next scale' dollies out for ≤700 ms on the glide token, then crossfades to the next stage framed so the previous subject fills the square.
- Editorial-type counters update with the frame ('this square: 5 nm across; about 3,800 molecules inside').
- Back is symmetric.

Within a stage: the normal flick and orbit (C021) with a c-axis detent. Tap the S1 ring and it pulses (C028). C095's guess prompt: 'How many molecules are in this square?' The camera never moves without input.

**Experience:** Phone: a Next-scale button in the thumb zone; pinching out past a threshold also advances one stage (never a continuous zoom). Low Power: stills with crossfades. Desktop: + and − keys and snapping scroll. Keyboard: +/−, and Tab to the sliders. Screen reader: each stage announces its title, scale and counter, and the snowflake sliders are role=slider with valuetext. Reduced motion: stage cuts with 150 ms crossfades and no dolly.

**Tech:** GenIce2 (MIT; ice Ih '1h'; --rep supercells; gro/xyz output) run offline into gallery assets with provenance; R5 cluster splats and instanced block tiling; a DOM crossfade or useRenderPipeline transition(); Reiter's cellular automaton on a ~400×400 hex grid in a worker, output as SVG paths; math/random mulberry32 seeds; math/time springs for the dolly.

**Backend:** mixed

**Rides (v10 requirements):** R3, R5 (cluster splats and tiling), R6 (optional transition)

**v9 slice:** S0-S2 as a guided sequence of three assets (the existing water and new ice assets) with camera presets, the DOM square frame and counters, plus the S5 snowflake generator in DOM/SVG. S3 waits for R5.

**WebGL2 fallback:** S3 draws fewer tiles and leans on cluster splats; every other stage is identical.

**Where in code:** packages/ui/src/gallery-data.json (water, water_cluster_64, this_is_water); new ice assets under apps/web/public/gallery/ with provenance; packages/scene/src/AtomClusters.tsx (far-LOD splats); BillionAtomBlock.tsx; ScaleBar.tsx; Learn panel; a link from the home Water model

**Risks:** Tiling one hydrogen arrangement repeats it every 5 nm, which the label states. The Reiter parameters aren't physical temperatures, so the sliders are labelled qualitative. Discrete stages risk feeling less magical than a continuous zoom; the fixed square frame carries the continuity. New ice assets need curation-gate provenance.

**Honesty:**

- Only S0-S3 draw atoms, and each names its source.
- S4 and S5 are illustrations with computed counts, labelled as such.
- The snowflake is 'grown with a published toy model'.
- The six-fold symmetry is attributed to ice Ih's hexagonal lattice (textbook).
- Journey motion is camera-only, and export uses each stage's structure without it.

**Judges:**

- E 3/keep: Discrete stages with their own origin and near/far planes sidestep precision. GenIce2 is an offline bake and the Reiter snowflake runs in a worker. It hosts real-14's existing-asset stages as the v9 slice. *Improve:* Ship S0-S2 on existing and new ice assets first, with the snowflake stage last.
- P 4/keep: A staged journey from one water molecule to a snowflake you grow and keep has a real payoff to show a friend, and discrete stages avoid vestibular trouble. The risk is a slideshow feel. *Improve:* Give each stage one verb (tug the hydrogen bonds, tile, grow), and absorb Water Zoomed Out's tug stage.
- A 4/keep: The Eames square frame, discrete stages, and an ending on a snowflake grown in ink. The representation turns to ink as the scale grows, which fits Ink and Light. *Improve:* Host rt-14. Design the S3-to-S4 change of medium as Ink-to-Light in reverse, and label the tiling honestly.
- Pr 4/keep: 'Why do snowflakes have six sides?' is a searchable curiosity hook, and the journey starts from the home Water model. The GenIce2 data needs provenance. It hosts real-twins-14. *Improve:* Ship stages S0-S2 on existing files first, and label the Reiter model qualitative.
- M 3/merge: Merge into RT-14. It is a second Powers of Ten; RT-14 is more honest and ships on v9. *Improve:* Bring the snowflake end card into RT-14.

<a id="r2-signature-and-moonshots-14"></a>
## Moonshot: Made-Of, the /scan dissolve rebuilt on the Condense motif
`R2-signature-and-moonshots-14` · moonshot · effort L · judges mean **3.2** (E3 P3 A4 Pr3 M3; keep 5) · self-scored fun 4 / visual 4 · perf costs

> After /scan identifies a subject, its particle cloud peels left to right into the molecules it probably contains and condenses atom by atom onto real structures lined up like specimen jars. It uses the gist engine's existing setHomes() rather than splats, a no-token demo is the default showcase, and an ink-plate dissolve covers everything else.

**Framing:** problem->solution

**Builds on:** C069 + C067 + C030 + C101 (parked) + C017

**Problem:** C069 split the judges: the playtester, art director and product steward called it the heart of /scan, but it leaned on WebGPU-only GaussianSplat, unverified device sharing and HF_TOKEN. Animating an object into molecules also risks making an inference look like evidence ('amounts' implied by particle shares).

**Solution:**

1) No splats: the gist engine already exposes setHomes(points), a per-particle 3D home with packed colour (gistEngine.ts, HOME_FLOATS = 8). The dissolve is new homes, not a new renderer.
2) Targets: the K 'probably contains' candidates (vision model plus Jev ranking, as today) are laid out as real structures (gallery or PubChem coordinates) in a row at one shared scale on the plate, like specimen jars. Each atom gets ⌊P/A⌋ particles on a hand-rolled Fibonacci sphere of its display radius, coloured by the Specimen palette.
3) A coherent peel: particles are matched to targets monotonically (sorted by x then y), so streams don't cross and the object peels left to right on the release and gather tokens.
4) No amounts: each candidate's particles are proportional to its atom count, never to the model's 'rough shares'. The headline reads 'probably contains · amounts not shown'.
5) End frame: the particles resolve onto atoms, and each card shows the name, formula and 'probably' with Jev's confidence. Tapping a molecule opens it in the viewer; on v10 the gist particles live in the main canvas, so the tapped cluster flows straight into the atoms (on v9, a crossfade).
6) Demo first: three no-token demos (the existing DEMO_GISTS plus pre-baked, subsampled and quantised lupi.points.v1 clouds as static assets) with hand-authored, cited compositions (pencil: graphite, and cellulose in the wood), labelled 'curated demo'. The home link opens a demo that plays at once.
7) While waiting, visitors can stir the cloud (C067 pointer forces).
8) Gate for the [GPU] path: a real-device test that iPhone Safari accepts maxStorageBuffersInVertexStage (fact-sheet open question 1), plus C014 data at 60k/120k particles.

**Experience:** Phone with WebGPU: take a photo or tap a demo. The swirl becomes the object's shape, then peels into water, glucose and amylose lined up, each condensing with a click; tap glucose and the viewer opens. Old iPhone or GL2: the existing swirl or CSS fallback, then each candidate's Illustrate plate forms from an SVG dot dissolve (≤200 dots per molecule). Keyboard: Tab through the candidate cards, Enter opens one. Screen reader: 'Probably contains: water, glucose, amylose. Amounts not shown.' Reduced motion: the photo crossfades to the cards.

**Tech:** vgpu 0.4.0 gist engine: setHomes and gist-step.wgsl pointer forces (existing; vgpu 0.5.0 breaks the texture API, so stay on 0.4.0); a later TSL compute port on the main canvas device (R12; vgpu initFromDevice sharing unverified); math/random; the lupi.points.v1 format; /v1/scan/identify with Jev; the CPU Illustrate renderer for the fallback plates.

**Backend:** [GPU]

**Rides (v10 requirements):** R12 (shared device, later), R3 (the flow into atoms)

**v9 slice:** Yes, most of it: the setHomes peel on today's vgpu engine, the demo assets, the honest cards and the SVG fallback. No three.js port is needed.

**WebGL2 fallback:** The swirl or CSS fallback, then an SVG dot dissolve into Illustrate plates of the candidates.

**Where in code:** packages/ui/src/scan/ScanPage.tsx (DEMO_GISTS, demo mode ~243-461); scan/gist/gistEngine.ts (setHomes, HOME_FLOATS); gistClient.ts; identify.ts; apps/mcp-worker/src/scan.ts; docs/scan-pipeline.md

**Risks:**

- Particle budget against atom count: fine for small molecules, not for a protein, so candidates are capped by atom count.
- The demo point clouds add weight (subsample and quantise).
- The iPhone storage-buffer limit is unverified.
- The dissolve is emotionally persuasive, so the 'probably' wording must stay prominent.

**Honesty:** The dissolve is labelled an illustration of 'probably contains'. Particles aren't atoms until they land on real, sourced coordinates. No amounts are implied, demo compositions cite their sources, and the result is never saved as a structure.

**Judges:**

- E 3/keep: Reusing the existing vgpu setHomes() instead of splats makes most of it v9-feasible at low cost. It stays WebGPU-only with an SVG fallback, and the iPhone vertex storage-buffer limit is unverified. *Improve:* Verify the iPhone limit on a device first. Keep a no-token demo as the default and cap candidates by atom count.
- P 3/keep: A photo peeling into particles that condense into molecules is a magic trick, but it's gated on HF_TOKEN, iPhone limits and /scan traffic. *Improve:* Make the no-token demo the default, and let the particle cloud respond to touch.
- A 4/keep: Monotonic matching so particle streams never cross, and candidates lined up like specimen jars at one shared scale, is good motion design. It ties /scan to the house motif. *Improve:* Particles use the Specimen palette only. Make the demo the first thing people see.
- Pr 3/keep: The strongest viral hook for /scan, but HF_TOKEN spend has no cost owner and iPhone WebGPU limits are unverified. Making the no-token demo the default is right. *Improve:* Name a cost owner, and make the demo the default.
- M 3/keep: It has an SVG dot fallback, but photo upload runs over cellular, and the iPhone storage-buffer limit is unverified. *Improve:* Make the no-token demo the default (no upload), add a size chip, and test the limit on a device first.
