# Ink and Light

Short-list item 15 ([round 2: Ink and Light](brainstorm/2026-09-viewer-play/round2/signature-and-moonshots.md#r2-signature-and-moonshots-06)).
Lupi's ink drawing (the home hero, the `/m` pages and their cards, Lupi Daily) is now a Look inside the 3D viewer, and the landing's molecule tiles are ink drawings that light up into the 3D molecule.

Engrave and Halftone have been seen in headless Chromium (SwiftShader, on the WebGPU and WebGL2 backends) through the `ink` smoke plugin; nothing here has been seen on a phone or a hardware GPU. Every tuning value is a first guess.

## What a visitor gets

### The Illustrate look

- **Illustrate**: flat colour on the sage plate, ink at every edge. **Sketch**: pen hatching on the paper plate (`#e7ebe3`, the Daily's paper). **Engrave**: a banknote line engraving on the paper plate. **Halftone**: print dots on the paper plate, like a comic or a riso print.
- **Where to find it:**
  - **Style → Looks**: Illustrate, Sketch, Engrave and Halftone, next to Studio, Paper, Night and Prism.
  - **The Play tray**: a Look row, *Lit · Ink*. Ink keeps your plate and light and only changes how the molecule is drawn. The pill flashes the change, and while the drawing is on its resting dot has an ink ring. No new chrome.
  - **The palette**: Ink, Sketch, Engrave, Halftone and Lit. The `I` key toggles ink and light.
  - **Ink and `I` bring back the last drawing used** in the tab (flat, hatched, engraved or halftone), whether it came from a Look or the Ink controls.
  - **All visual mods → Ink**: the drawing (off, flat colour, hatched, engraved, halftone dots), the ink weight and a sage or paper plate.
- **How the drawing is made:**
  - **Fills**: the CPK colour, lifted slightly toward paper, in three bands from the key light (shade, colour, lit) plus a cel catchlight. The bands follow the Light controls.
  - **Depth without screen-space AO**: crevices fall into the shade band through the baked contact occlusion, so the drawing holds still while it spins.
  - **Ink**: an outline at every atom's silhouette and along both edges of every bond. Atoms too small to carry a line lose it, and bonds thinner than about two lines become a single ink stroke, as in the drawings.
  - **Contour**: a screen-space pass over the finished picture adds the lines an impostor cannot draw for itself:
    - **meeting lines** where two balls interpenetrate (space-filling) or a stick enters a ball, from the depth around each pixel;
    - **steps**, a line on the near side wherever the depth jumps, so things without their own ink (far-LOD clusters, bricks) are outlined too;
    - **the outer contour**, the molecule against the plate, about twice the inner weight. It lies inside the silhouette, so it never paints the plate. A feature with plate close on both sides (a thin bond across a hole in a cage) keeps its own outline instead of turning solid.
  - **Sketch** adds strokes in the shade, crossed in the deepest shade.
  - **Engrave** cuts three plates of fine lines, as on a banknote: a base plate at 8°, a plate at 80° in the shade and one at −30° in the deepest shade. Lines swell with the shade until they merge, and thin away on the lit side. Each ball's lines are cut about its own centre (each stick's about its midpoint) and bow over it like the parallels of a slightly tilted globe, so the lines travel with the ball as the molecule turns. The burin meanders a little (Perlin noise). The colour shows between the lines.
  - **Halftone** lays ink dots on a 45° screen over the lifted colour. The dots grow with the shade and nearly merge in the deepest shade; the lit side and the catchlight stay clean, so the element colours read.
  - Engraving and halftone are ported by hand into TSL from [Shaders](https://shaders.com) (MIT): the Engraving component's line plates and the Halftone component's dot plate. Their tone is the drawing's own light value (half-Lambert × baked occlusion), not screen brightness. Strokes and dots are laid out in full-picture pixels, like the hatching, so an export keeps the screen's weight and its tiles meet without seams. Neither reads time: a still view draws no frames.
  - **Depth**: the far side of the molecule fades toward the plate (up to 40 %), as the drawings fade their back atoms.
- **Transitions**: switching between ink and light from the tray, the palette or `I` runs as a Light Fuse (below), about a second. A change from anywhere else (an agent's `lupi.set_viewer`, the Looks grid, a link) fades over about half a second, and so does switching between any two drawings (each has its own weight).
- **Effects**: while ink is on, the effect recipe rests (no AO, glow, focus, vignette or tone mapping), so the flat colours and the ink reach the screen exactly. Turning ink off brings the recipe back unchanged. While the look changes (a fade, a Light Fuse, Ink-to-Light's hand-off) the recipe follows the drawing pixel by pixel: it rests only where the ink is, so the part not yet reached keeps its look. The contour runs while the drawing shows (the look is on, or still fading out, or Ink-to-Light is handing over) and fades with it, pixel by pixel too.
- **A new molecule** keeps the Illustrate look.
- **Sharing**: share links, saved views and settings remembered on the device all keep the look. In the `s=` state and the short `ink=` link the drawings are `f` (flat), `h` (hatched), `e` (engraved) and `d` (halftone dots); `f` and `h` read as before.
- **Exports** draw it: PNG, JPEG, WebP, thumbnails and MCP images. Line weight follows the export's size, so a 2160 px export has the screen's weight. The contour is drawn once over the whole assembled picture, so a tiled export shows no seam. Over a transparent background it inks the molecule only.

### Ink tiles and Ink-to-Light

- **Ink tiles:**
  - Every molecule with a page (69 small gallery molecules) shows its own ink drawing on its molecule-wall tile, its finder row and its library card, on the sage plate. It is the `/m` page's drawing at its opening pose.
  - A tap lights the drawing with a lime glow. The relay then grows it to the size the 3D view will draw the molecule at.
  - While the viewer loads, the drawing turns like the hero's: drag it, flick it, and it clicks onto a ring or axis view and names it. Its model (`/og/m/<id>-ink.json`, a couple of kB) is fetched as a finger or pointer reaches the tile, or as a finder match appears. The 3D view opens at the pose you leave, with your spin.
  - Inside the viewer, the molecule switcher's rows are ink drawings too. Picking one opens the molecule at the row's angle, in ink, and the light comes on (there is no relay inside the viewer).
- **Ink-to-Light:**
  - The 3D view opens in ink, at the drawing's pose and size, and inflates into depth (the hero's flat arrival).
  - Once the relay has faded, the light comes on as a Light Fuse from the atom nearest you at the centre of the screen (about 1.1 s).
  - The same happens when you open a molecule from the home hero or from a molecule page.
  - Any touch, click, wheel or key completes it. Motion: Still skips it, and the molecule opens lit.

### The Light Fuse

- **What it is**: the change between ink and light starts at one atom and travels through the molecule along its bonds, like a lit fuse. Each atom takes the new look when the front reaches its hop distance from the seed, and on every bond the front runs down the stick from one atom to the other.
- **The edge** is broken up like burning paper: a soft front pushed about by three octaves of noise that sit on the balls and sticks themselves, so the edge does not swim when the molecule turns (after the Shaders NoiseDissolve).
- **The ember**: a thin line of the brand lime (`#d5ef9c`) burns along the front, on the noisy edge itself. It reaches further into the light than into the ink, so it glows on the side the light is on, whichever way the fuse burns. It fades in over the run's first eighth and out over its last. It reads the front's progress only, never a clock, so a held fuse stands still.
- **The effects follow the front**: the part the front has not reached keeps its look. Ink coming in leaves the lit part its AO, glow, vignette and tone mapping until the front gets there; the light coming on leaves the waiting ink exactly as drawn. The inked part neither glows nor takes glow from the lit part.
- **The seed**:
  - Ink-to-Light: the atom nearest you at the centre of the screen.
  - The tray, the palette or `I`: the selected atom, else the atom under the pointer, else the centre-front atom.
  - Ink comes in the same way: the drawing starts at the seed and spreads.
- **Pace**: hops are divided by the seed's farthest hop, so the whole fuse takes about 1.1 s whatever the size of the molecule.
- **What the front follows**:
  - Up to 2,000 atoms with bonds shown, the drawn bonds (dashed coordination and dotted ionic contacts included). Fragments the bonds do not reach (salts, solvent, ions, a second molecule) take a hop from their distance to the nearest reached atom, in bond lengths, and the front carries on through their own bonds.
  - Above 2,000 atoms, or with bonds hidden, the distance from the seed: a spherical wavefront.
  - Above 250,000 atoms, the whole molecule crossfades as before.
- **Changing your mind**: a second toggle while the fuse burns turns its front round, back toward the seed.
- **Motion**: Still cuts it (no fuse). Gentle runs it at the same pace: it is a change of look, not motion. Any touch, click, wheel or key completes Ink-to-Light.
- **Quiet Idle**: the loop stays awake only while a fuse burns. When it settles, the recipe moves to the look's own graph, and the picture does not change.

## Truth rules

- **A Look, not toy motion.** Illustrate never moves an atom and never changes data, and exports carry it. The fades, the Light Fuse, its ember and the hand-off drawing are display-only: every capture renders the configured look (a capture guard sets the target value and turns the fuse off), never a half-faded or half-fused one, and never an ember.
- **The recipe at rest is unchanged.** Exports never go through the live post chain, and at rest the live chain is the look's own graph (the cheaper ink graph under the drawing), so an export's bytes do not depend on the fuse or on how the recipe follows it.
- **Agents see no fuse.** `lupi.set_viewer { inkStyle }` crossfades as before; only the UI's own toggles and Ink-to-Light fuse.
- **Artifact identity.** The spec records `view.ink` only while the look is on, so every lit spec keeps its `specId`. `view.ink` requires `view.postprocess` to be `raw-scene`.
- **The contour in the spec.** `view.ink.contour` is `{ pipeline: 'ink-contour.v1', inner, outer }` (line widths in ink units), so a contoured drawing never shares a `specId` with the drawing before it. An ink spec without it (written before the contour) still validates and exports without one.
- **The contour in the capture.** An ink capture assembles its tiles as a look capture does (colour clamped as the raw path clamps it, the nearest depth of each block, and coverage), then inks the contour once at the output resolution. It has no time and no noise, so a still view stays still and an export repeats. The renderer fingerprint's determinism facts name it (`ink-clamp=alpha`, `ink-contour.v1-output-resolution`), so every V2 render-parity candidate needs re-deriving.

## Where it lives

| Piece | File |
|---|---|
| The drawing: fills, outline, hatching, engraving, halftone, `uInkPx`, capture guard | `packages/scene/src/tsl/inkLook.ts` |
| Mixed into the impostors (one uniform branch each) | `packages/scene/src/tsl/atomImpostorMaterial.ts`, `bondImpostorMaterial.ts` |
| Fades, Ink-to-Light and running the Light Fuse | `packages/ui/src/ink/InkLookDriver.tsx` |
| The fuse's hops (bond steps, gaps between fragments, spatial fallback) and the centre-front seed | `packages/ui/src/ink/fuseHops.ts` |
| The fuse on the impostors: uniforms, hop textures, the noisy front, the ember, the fragment's offset for the recipe, its capture guard | `packages/scene/src/tsl/inkFuse.ts` |
| Bonds handing their pairs to the fuse | `packages/scene/src/Bonds.tsx` |
| Ink on and off (tray, palette, `I`), the last drawing used, the `ink=` link, and asking for a fuse | `packages/ui/src/ink/illustrate.ts` |
| Looks and the paper plate | `packages/ui/src/sceneLooks.ts`, `backgroundPresets.ts` |
| Local smoke (all four drawings, exports of Engrave and Halftone) | `tools/smoke/scenarios/ink.mjs` |
| The post recipe stepping aside | `packages/ui/src/postprocess/controls.ts` (`inkRecipe`) |
| The recipe following a change pixel by pixel: the phase (lit, ink, changing), the fuse offset beside coverage, the stages resting by the live mix | `controls.ts` (`inkPhase`), `ScenePostprocessing.tsx` (`useInkPhase`), `backgroundMask.ts`, `postPipeline.ts` (`inkFade`) |
| The contour (one TSL node, live and in exports) | `packages/ui/src/postprocess/inkContour.ts`, in `postPipeline.ts` and `export/captureLookPass.ts` |
| The spec (`view.ink`) | `packages/ui/src/mcp/renderArtifactAdapter.ts`, `packages/core/src/renderArtifact.ts` |
| Ink tiles | `packages/ui/src/landing/inkTiles.ts`, `MoleculeWall.tsx`, `MoleculeFinder.tsx`, `library/GalleryCollection.tsx`, `switcher/switchIndex.ts`, `relay/stage.ts` |
| Tile poses, fit and drawing models | `scripts/molecule-pages/build.mts` (`/m/manifest.json`, `/og/m/<id>-ink.json`) |

Agents: `lupi.set_viewer { inkStyle: 'flat' | 'hatch' | 'engrave' | 'halftone' | 'off', inkWeight }`; commands understand *ink*, *illustrate*, *hatched*, *sketch*, *engrave*, *engraving*, *etching*, *halftone*, *print*, *dots* and *lit*; `__lupiPlay.ink()` reports `{ mix, hatch, engrave, halftone, weight, target, holding, fading, arrival, fuse }`, with `fuse: { running, seed, progress, mode, held }` (`mode` is `'graph'`, `'spatial'` or `'uniform'`, null before the first fuse). `__lupiPlay.ink('hold', p)` holds the front at `p` (0..1), the running fuse's or the next one's, `ink('release')` lets it burn on, and `ink('pace', k)` runs fuses `k` times slower; the fuse smoke (`tools/smoke/scenarios/fuse.mjs`) uses them on software renderers, which draw a frame or two a second, for its filmstrips, its export check and its held fronts (the part not yet reached against the plain lit and ink views, and the ember's lime on the front).

`?contour=0` (also inside a hash route) leaves the contour out of the live view and of exports, whose specs then carry no `view.ink.contour`: a debug switch for before-and-after comparisons. The local smoke plugin `tools/smoke/scenarios/contour.mjs` uses it.

## Tuning points

| What | Value | Where |
|---|---|---|
| Outline width | atoms 1.5, bonds 1.15 ink units (one ink unit is one CSS px on a 900 px picture; the scale is clamped to 0.85–2.6×) | `INK_LOOK_TUNING` |
| Bands | shade below 0.36, lit above 0.74 (half-Lambert × occlusion), catchlight at N·H > 0.968 | `INK_LOOK_TUNING` |
| Fills | lifted toward paper 8 % (flat) or 40 % (hatched); shade 46 % (flat) or 14 % (hatched) toward `#1a2321` | `INK_LOOK_TUNING` |
| Hatching | spacing 4.4 units, strokes up to 52 % of it; single strokes from darkness 0.40, crossed from 0.62 | `INK_LOOK_TUNING` |
| Engraving | lines 4 units apart (the shade plates 0.92× and 1.13× as dense) at 8°, +72° and −38°; each plate's axis leans 14° toward the viewer; tone contrast 1.6 about mid-grey, never darker than 0.12; brightness shifts the lines by 0.35 × 1.5 periods; a meander of 0.7 spacing over a 30-spacing wavelength; lines at 92 % ink; fills lifted 30 % toward paper, shade 10 % | `INK_LOOK_TUNING` |
| Halftone | dot pitch 5.6 units on a 45° screen; dots from darkness 0.28 to their largest (0.64 of the pitch, nearly merged) at 0.86; 88 % ink; fills lifted 16 %, shade 6 % | `INK_LOOK_TUNING` |
| Ink colour | `#0c1211` | `INK_LOOK_COLORS` |
| Depth cue | the back of the bounding sphere fades 40 % toward the plate, from 15 % of the depth on | `INK_LOOK_TUNING` |
| Contour widths | inner lines 1.3, outer contour 2.6 ink units | `INK_CONTOUR_TUNING` |
| Contour thresholds | meeting lines from a slope turn of 0.22 (full at 0.6); steps from a Sobel slope of 2.5 (full at 5); a tap steeper than 2.5 is across a step; coverage 0.25–0.75 reads as molecule | `INK_CONTOUR_TUNING` (part of `ink-contour.v1`) |
| Fades | lit ⇄ ink and drawing ⇄ drawing 480 ms (agents, Looks, frames above 250,000 atoms); Ink-to-Light waits 200 ms after the first frame | `InkLookDriver.tsx` |
| Light Fuse pace | 1,100 ms from the seed to the last atom, at a constant speed | `INK_FUSE_MS` |
| Fuse edge | half-width 0.3 bond steps (normalised 0.02–0.15); the noise moves the front by about a hop either way (2.5 bond steps of weight, at least 0.05 of the run); 3 noise cells per bond length | `FUSE_EDGE` |
| Ember | `#d5ef9c` at 1.2× brightness, turning the surface up to 70 % toward it at the front; reaching 0.7 of the edge's half-width into the light and 0.22 into the ink; fading in and out over the first and last 12 % of the run | `FUSE_EMBER` |
| Fuse reach | the bond graph up to 2,000 atoms, a spherical wavefront up to 250,000, a crossfade above; gaps measured in bond lengths (the drawn bonds' mean, else 1.5 Å) | `FUSE_HOPS` |
| Centre-front seed | closest to the centre line, with depth behind the nearest atom counted at 0.5 per unit | `FUSE_HOPS.frontDepthWeight` |

## Half-done and next

- **Unseen.** The band thresholds, line weights, hatching density and the hand-off timing are first guesses. Engrave, Halftone, the contour and the Light Fuse were tuned from headless SwiftShader screenshots only; the fuse was seen at a frame or two a second (held and slowed), never at 60 fps.
- **Engrave and Halftone are screen-bound in one way each.** The engraving's meander and the halftone screen sit on the picture, not the molecule, so while the molecule turns the dots stay put on the page and the meander drifts slightly across the balls (the lines themselves travel with each ball). Small atoms (under about two line spacings across) and thin bonds lose their lines and dots, as they lose hatching.
- **The ember was seen in SwiftShader only**, held still. Its width, strength and fade are first guesses; on a real screen at 60 fps it may want to be brighter, or to flicker with the front's own progress.
- **The plate around the molecule follows the look's fade, not the front.** Pixels without an impostor (the plate, cell lines, far-LOD clusters) take the recipe by `uInkMix`, so the glow spilling onto the plate around the lit part fades evenly over the fuse instead of with the front.
- **A change costs two graph builds.** The recipe's graph is rebuilt into the lit graph (with every stage resting by the mix) when the look starts changing and into the look's own graph when it settles; the lit recipe's AO, glow and defocus passes run through the change, under ink too. Still cuts, so it builds once. Diagram has no stage to rest and keeps one graph.
- **The match frame is close, not exact.**
  - The relay's drawing is the lit SVG (gradient balls) at an orthographic pose, while the first 3D frame is the toon look in perspective. The pose, size and plate match; the shading style changes over the 120 ms crossfade.
  - The viewer may fit a little tighter or looser than the drawing's size if the visitor's atom scale is not 1.
- **No calibration goldens** between the SVG drawing and the TSL look. There is no CPU SVG engine for cards beyond the existing `/m` drawing, no resvg Worker cards from saved views, and no no-GPU fallback plate.
- **The contour is tuned on two molecules.** Space-filling caffeine and ball-and-stick C60, in a software renderer (SwiftShader) on both backends. Its thresholds are first guesses.
  - On the dark sage plate the outer contour is ink on near-black, so it reads only as a slightly smaller molecule; it shows on paper (Sketch) and light plates.
  - The holes of a cage are plate too, so the rims around them get the outer weight where the plate shows through.
  - Meeting lines come from depth alone (no normal buffer: the impostors write none). Far zoomed out, the depth buffer's own grain sets a floor and faint creases drop out.
  - The export contour has no anti-aliasing beyond its soft thresholds (the live view has FXAA after it).
- **Cost.** The contour reads 34 texels per pixel (nine of depth, 25 of coverage) in one full-screen pass, and the scene pass writes its coverage target while the drawing shows. Quiet Idle draws no frames on a still view, so it costs nothing at rest.
- **Refractive glass** draws real spheres, so it has no ink. Far-LOD clusters and the billion-atom bricks are not inked either.
- **Raster exports with bonds** still fail closed (an existing rule), so inked bonds appear in interactive exports only.
