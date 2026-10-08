# The morph arrival

Sprint S1, track t3. When a visitor switches from one molecule to another inside the viewer, the atoms on screen flow into the new molecule: C60 → caffeine rearranges the cage's carbons into the caffeine skeleton, and caffeine → water collapses into three atoms.

Seen running on SwiftShader only (both backends, desktop), at a few frames a second. The timing and the look on a real phone or GPU are unjudged; every tuning value is a first guess.

## What a visitor gets

- **When it plays:** a switch inside the viewer from a molecule on screen to another: the molecule switcher, the finder, a library or random pick, the palette. The new molecule arrives as a morph instead of the mist or the flat inflate.
- **What it looks like:**
  - Each atom of the new molecule starts where a matched atom of the previous molecule was on screen and flies home. Colours are the new atoms' own from the first frame.
  - The old shape starts exactly where the screen showed it, at the size the camera fit gave it, even when the new molecule opens at another angle (an ink row's pose).
  - The centre leaves first and the rim follows up to 0.15 s later, so the landing reads as a flow. The whole morph takes 0.9 s.
  - Bonds follow their two atoms, thin as they stretch and glow lime with the strain, as under the other toys.
  - Old atoms without a partner vanish at the switch. New atoms past the old supply bud out of their nearest matched neighbour.
- **Ink-to-Light** runs alongside: a switcher row opens the molecule in ink at the row's angle, the atoms flow in, and the light comes on as before.
- **Any touch, click, wheel or key** lands it at once, like every arrival.
- **Motion:** Standard as above. Gentle: half the travel in 0.55 s. Still: no morph, the molecule cuts in.
- **"Illustrative"** shows on the pill while it runs, as for the arrival.

## When it never plays

- The first open of a session's viewer (nothing was on screen).
- Either molecule over 20,000 atoms, or a previous molecule still streaming in. These use the ordinary arrival.
- A trajectory (more than one frame), playback, the refractive-glass renderer, the MCP route, embeds and `?arrival=0`.
- A molecule an MCP command loads (`lupi.*` tools stay instant), and a page carrying `mcpCommand`, `command` or `batchExport`.
- The home hero's or a molecule page's hand-off (the relay): its drawing inflates flat, as before.
- A saved view's route.

## How it works

- **What the screen showed.** Every drawn frame, the Play layer remembers the molecule on screen, whether all its atoms were resident, and the camera.
- **The plan** (`packages/ui/src/play/morphMatch.ts`, pure), made on the new molecule's first frame with the live camera:
  - **Frames.** Each molecule goes into its own view's frame: the camera's right, up and back axes around the anchor (the point on the view axis at the molecule centre's depth), divided by that depth. In perspective a point keeps its place on screen when its view coordinates scale together, so the old molecule drawn in the new view at the same coordinates starts where the screen showed it. Without a usable depth (an orthographic camera) both use their centre and radius.
  - **Matching**, in that shared frame: same element first, then any element, each old atom used at most once. Nearest pairs win: candidate pairs come from a spatial grid and the shortest are assigned first, in rounds. Up to 500 new atoms, swaps that shorten the summed squared travel without losing a same-element pair run until none helps.
  - **Starts**: one texel per new atom, its partner's frame point and its delay.
- **On the GPU** (`packages/scene/src/tsl/displayMotion.ts`): the morph is the fifth arrival mode. The starts sit in one RGBA32F texture read with `textureLoad` at the atom's index; uniforms carry the new view's anchor and axes. The offset is `(start − rest) × (1 − S(t − delay)) × E(t)`, with the arrival's spring `S` and its end fade `E`, so it is exactly zero from the end on.
  - Atoms read their instance index. Bonds carry their two atom indices (`instanceAtomPair`), so each end reads its own atom's start.
  - A per-layer gate (`uMorphOn`) opens only for the layer drawing the frame the starts belong to.
- **The CPU twin** (`displayMotionTwin.ts`) mirrors the term. It finds the atom by its rest point's float32 bits, so labels, rings, measurements and the card anchor ride the morph like the other display motion.
- **Quiet Idle:** the loop is awake while the morph is armed or running and sleeps when it lands.

## Truth rules

- Display-only, like every arrival. It never moves `frame.positions`, the store, URLs, saved views or MCP output.
- Every capture renders with the master weight at zero, so exports, thumbnails and MCP artifacts never carry it: an export taken mid-morph has the `artifactDigest` of one taken at rest (smoke-checked on both backends). A video recording suspends it.
- The camera and the store pose are untouched; the morph moves only atoms and bonds.

## Where it lives

| Piece | File |
|---|---|
| The plan: frames, matching, budding, stagger, the gate | `packages/ui/src/play/morphMatch.ts` (+ test) |
| What the screen showed, arming, planning, release | `packages/ui/src/play/PlayLayer.tsx` |
| The GPU term, texture and gate | `packages/scene/src/tsl/displayMotion.ts` |
| The CPU twin | `packages/scene/src/tsl/displayMotionTwin.ts` |
| Atom and bond plumbing | `atomImpostorMaterial.ts`, `bondImpostorMaterial.ts`, `AtomsOptimized.tsx`, `Bonds.tsx` |
| MCP loads stay instant | `packages/ui/src/mcp/activity.ts`, `mcpViewerBridge.tsx` |
| Local smoke | `tools/smoke/scenarios/morph.mjs` |

Agents: `__lupiPlay.state().motion.arrival` reads `armed morph`, then `morph`; `.motion.morph` is `{ running, planned, atoms, previousAtoms, sameElement, crossElement, budded, vanished, frame, planMs }` while one runs, and `.motion.lastMorph` keeps the last plan's counts. `__lupiPlay.morph()` plays the last switch's morph again while its molecule is on screen.

## Tuning points

| What | Value | Where |
|---|---|---|
| Length and spring | Standard 0.9 s on the settle token (critically damped); Gentle 0.55 s on glide, half the travel | `MORPH_D`, `arrivalFeel` in `PlayLayer.tsx` |
| Stagger | the rim leaves 0.15 s after the centre (Gentle 0.075 s) | `MORPH_TUNING.maxDelayS` |
| Limits | 20,000 atoms each; the swap pass up to 500 new atoms | `MORPH_TUNING` |
| MCP grace | a switch within 1.5 s of an MCP command is instant | `mcpActiveWithin` |

## Half-done and next

- **Bond glow.** Stretched bonds glow lime as under Tug and Burst; a long flight can read as a lime string figure for a moment. A morph-only damping of the strain glow is one uniform away.
- **The hold before the flow.** The morph waits for the new file's first-frame mark (up to 0.6 s for its bonds), showing the old shape in the new colours until then.
- **Ink rows.** A switcher or finder row hands an ink drawing; the morph replaces its flat inflate inside the viewer, and the ink still hands over to light. The relay from the home page or a molecule page keeps the flat inflate.
- **Not matched by bonds or rings.** Matching is by element and distance only; a topology-aware match (rings onto rings) would read better on larger switches.
