# Ink and Light

Short-list item 15 ([round 2: Ink and Light](brainstorm/2026-09-viewer-play/round2/signature-and-moonshots.md#r2-signature-and-moonshots-06)).
Lupi's ink drawing (the home hero, the `/m` pages and their cards, Lupi Daily) is now a Look inside the 3D viewer, and the landing's molecule tiles are ink drawings that light up into the 3D molecule.

Nothing here has been seen running in a browser yet. Every tuning value is a first guess.

## What a visitor gets

### The Illustrate look

- **Illustrate**: flat colour on the sage plate, ink at every edge. **Sketch**: pen hatching on the paper plate (`#e7ebe3`, the Daily's paper).
- **Where to find it:**
  - **Style → Looks**: Illustrate and Sketch, next to Studio, Paper, Night and Prism.
  - **The Play tray**: a Look row, *Lit · Ink*. Ink keeps your plate and light and only changes how the molecule is drawn. The pill flashes the change, and while the drawing is on its resting dot has an ink ring. No new chrome.
  - **The palette**: Ink, Sketch and Lit. The `I` key toggles ink and light.
  - **All visual mods → Ink**: the drawing (off, flat colour, hatched), the ink weight and a sage or paper plate.
- **How the drawing is made:**
  - **Fills**: the CPK colour, lifted slightly toward paper, in three bands from the key light (shade, colour, lit) plus a cel catchlight. The bands follow the Light controls.
  - **Depth without screen-space AO**: crevices fall into the shade band through the baked contact occlusion, so the drawing holds still while it spins.
  - **Ink**: an outline at every atom's silhouette and along both edges of every bond. Atoms too small to carry a line lose it, and bonds thinner than about two lines become a single ink stroke, as in the drawings.
  - **Sketch** adds strokes in the shade, crossed in the deepest shade.
- **Transitions**: switching between ink and light fades over about half a second.
- **Effects**: while ink is on, the effect recipe rests (no AO, glow, focus, vignette or tone mapping), so the flat colours and the ink reach the screen exactly. Turning ink off brings the recipe back unchanged.
- **A new molecule** keeps the Illustrate look.
- **Sharing**: share links, saved views and settings remembered on the device all keep the look.
- **Exports** draw it: PNG, JPEG, WebP, thumbnails and MCP images. Line weight follows the export's size, so a 2160 px export has the screen's weight.

### Ink tiles and Ink-to-Light

- **Ink tiles:**
  - Every molecule with a page (69 small gallery molecules) shows its own ink drawing on its molecule-wall tile, its finder row and its library card, on the sage plate. It is the `/m` page's drawing at its opening pose.
  - A tap lights the drawing with a lime glow. The relay then grows it to the size the 3D view will draw the molecule at.
  - While the viewer loads, the drawing turns like the hero's: drag it, flick it, and it clicks onto a ring or axis view and names it. Its model (`/og/m/<id>-ink.json`, a couple of kB) is fetched as a finger or pointer reaches the tile, or as a finder match appears. The 3D view opens at the pose you leave, with your spin.
- **Ink-to-Light:**
  - The 3D view opens in ink, at the drawing's pose and size, and inflates into depth (the hero's flat arrival).
  - Once the relay has faded, the light comes on (about 0.5 s).
  - The same happens when you open a molecule from the home hero or from a molecule page.
  - Any touch, click, wheel or key completes it. Motion: Still skips it, and the molecule opens lit.

## Truth rules

- **A Look, not toy motion.** Illustrate never moves an atom and never changes data, and exports carry it. The fades and the hand-off drawing are display-only: every capture renders the configured look (a capture guard sets the target value), never a half-faded one.
- **Artifact identity.** The spec records `view.ink` only while the look is on, so every lit spec keeps its `specId`; the render-parity candidates do not need re-deriving for this change. `view.ink` requires `view.postprocess` to be `raw-scene`.

## Where it lives

| Piece | File |
|---|---|
| The drawing: fills, outline, hatching, `uInkPx`, capture guard | `packages/scene/src/tsl/inkLook.ts` |
| Mixed into the impostors (one uniform branch each) | `packages/scene/src/tsl/atomImpostorMaterial.ts`, `bondImpostorMaterial.ts` |
| Fades and Ink-to-Light | `packages/ui/src/ink/InkLookDriver.tsx` |
| Ink on and off (tray, palette, `I`) | `packages/ui/src/ink/illustrate.ts` |
| Looks and the paper plate | `packages/ui/src/sceneLooks.ts`, `backgroundPresets.ts` |
| The post recipe stepping aside | `packages/ui/src/postprocess/controls.ts` (`inkRecipe`) |
| The spec (`view.ink`) | `packages/ui/src/mcp/renderArtifactAdapter.ts`, `packages/core/src/renderArtifact.ts` |
| Ink tiles | `packages/ui/src/landing/inkTiles.ts`, `MoleculeWall.tsx`, `MoleculeFinder.tsx`, `library/GalleryCollection.tsx`, `relay/stage.ts` |
| Tile poses, fit and drawing models | `scripts/molecule-pages/build.mts` (`/m/manifest.json`, `/og/m/<id>-ink.json`) |

Agents: `lupi.set_viewer { inkStyle: 'flat' | 'hatch' | 'off', inkWeight }`; commands understand *ink*, *illustrate*, *hatched*, *sketch* and *lit*; `__lupiPlay.ink()` reports `{ mix, hatch, weight, target, holding, fading, arrival }`.

## Tuning points

| What | Value | Where |
|---|---|---|
| Outline width | atoms 1.5, bonds 1.15 ink units (one ink unit is one CSS px on a 900 px picture; the scale is clamped to 0.85–2.6×) | `INK_LOOK_TUNING` |
| Bands | shade below 0.36, lit above 0.74 (half-Lambert × occlusion), catchlight at N·H > 0.968 | `INK_LOOK_TUNING` |
| Fills | lifted toward paper 8 % (flat) or 40 % (hatched); shade 46 % (flat) or 14 % (hatched) toward `#1a2321` | `INK_LOOK_TUNING` |
| Hatching | spacing 4.4 units, strokes up to 52 % of it; single strokes from darkness 0.40, crossed from 0.62 | `INK_LOOK_TUNING` |
| Ink colour | `#0c1211` | `INK_LOOK_COLORS` |
| Fades | lit ⇄ ink 480 ms; Ink-to-Light waits 200 ms after the first frame, then 520 ms | `InkLookDriver.tsx` |

## Half-done and next

- **Unseen.** The band thresholds, line weights, hatching density and the hand-off timing are first guesses.
- **The match frame is close, not exact.**
  - The relay's drawing is the lit SVG (gradient balls) at an orthographic pose, while the first 3D frame is the toon look in perspective. The pose, size and plate match; the shading style changes over the 120 ms crossfade.
  - The viewer may fit a little tighter or looser than the drawing's size if the visitor's atom scale is not 1.
- **No calibration goldens** between the SVG drawing and the TSL look. There is no CPU SVG engine for cards beyond the existing `/m` drawing, no resvg Worker cards from saved views, and no no-GPU fallback plate.
- **No screen-space contour.** The outline comes from each impostor's own silhouette, so the meeting line where two balls interpenetrate (space-filling) or where a stick enters a ball has no ink. A depth-discontinuity pass in the post chain (and in `captureLookPass.ts` for exports) would add it, with a heavier outer contour.
- **Refractive glass** draws real spheres, so it has no ink. Far-LOD clusters and the billion-atom bricks are not inked either.
- **Raster exports with bonds** still fail closed (an existing rule), so inked bonds appear in interactive exports only.
