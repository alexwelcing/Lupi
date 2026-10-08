# Sprint S2: status

All eight tracks of [the plan](README.md) are merged on `claude/nifty-volta-ophavr`, on top of Sprint S1 (81 commits from `9467376`; 134 files, +5,731 / −716). Together with S1 the branch is 152 commits from `main` (`11d1f4f`). Nothing is merged to `main` and nothing is deployed.

As in S1, everything visual was seen in headless Chromium on SwiftShader (WebGPU and WebGL2 lanes), never on a real GPU or a phone. The 390 px phone profile was run this time, mostly in the WebGL2 lane: the WebGPU lane at DPR 3 drew a frame every 15 s or more and could not finish.

## What shipped, by track

| Track | Share | Result | Screenshots |
|---|---|---|---|
| c1-chalk | Creative | **Chalk**, a fifth Illustrate drawing for the dark sage plate, after Shaders' Chalkboard: chalk outlines and contour (`#eceadb`), the element colour as a pastel rubbed over the board, three families of dusty strokes that thicken toward the light. Everywhere the other drawings are (Looks, palette, `I`, links with `c`, saved views, MCP, exports with their own `specId`). | `shots/c1-*` |
| c2-one-drawing | Creative | **One drawing everywhere.** The SVG ink drawings (`/m` pages and cards, wall, finder and library tiles, switcher rows, OMol25 picks, Daily) take the viewer's toon Illustrate look, and the relay eases a tile's drawing into the 3D view's perspective. The mean colour gap between a C60 tile and the first 3D ink frame halves (36 → 18 of 255); caffeine 14 → 12. The home hero has its own engine and is unchanged; `INK_DRAWING_STYLE = 'lit'` brings the old drawings back. | `shots/c2-*` |
| t1-fuse-2 | Technical | **The Light Fuse without its seams.** While the look changes, the post recipe (AO, glow, vignette, tone mapping, defocus) rests pixel by pixel with the front instead of switching at the toggle, and a thin lime **ember** burns along the front. The part not yet reached now matches its own look (99 % of pixels within 6 levels, against 7–23 % before). Lit, ink and hatch export digests are unchanged. | `shots/t1-*` |
| t2-replay-clips | Technical | **Frame-exact Instant Replay clips.** The 9:16 clip is rendered from the tape at a fixed 30 fps through WebCodecs into MP4 (`mp4-muxer`), H.264 first, then VP9 and AV1, with MediaRecorder as the fallback. A slow device takes longer instead of dropping frames, and the live canvas never resizes. Headless Chromium encodes only VP9/AV1, so the H.264 path is unseen. | `shots/t2-*` |
| p1-s1-loose-ends | Practical | `/scale`'s slider labels no longer overlap; the arrival waits for the "Opening…" plate to leave (and the pill no longer says "Illustrative" over it); the deep-assessment error no longer points at a CLI that does not exist; a dead `@atlas/export` alias out; the five `react-hooks/exhaustive-deps` warnings settled (one real fix in the cluster fade); the atom card never shows a home directory from the sphere-grid node paths. | `shots/p1-*` |
| p2-comfort-phone | Practical | S1's looks and motions on the 390 px phone and at Standard, Gentle and Still: a new `comfort` plugin, phone and Still variants of the S1 plugins, and harness fixes for a loaded machine. Found the phone contour bug below. Receipt: [qa-comfort-phone.md](qa-comfort-phone.md). | `shots/p2-*` |
| p3-tests-deps | Practical | The slow unit tests 2–8× cheaper in CPU (jsdom `*ByRole` queries and `expect()` in hot loops were the causes); `canonicalPath` in the scale spine O(d²) → O(d) with identical output (`pnpm apple:check` passes); Rive, gifenc and the unused renderer/scene dependencies out of the lockfile (42 lines removed, nothing else changed); dead App Shell CSS and two ignored `Bonds` props out. | `shots/p3-*` |
| p4-verifiers | Practical | Every local verifier run on the merged tree: `verify:exports` 14/14, `verify:mcp-bridge` 18/18 per lane, `verify:asset-quality` 413/413 (with a new Engrave case), every testbed case on both lanes. Found and fixed a **WebGPU bug from S1**: the morph's per-bond attribute pushed the trajectory bond program to 9 vertex buffers (WebGPU allows 8), so interpolated trajectories lost their bonds on WebGPU. Two stale testbed checks updated. Receipt: [verifiers.md](verifiers.md). | `shots/p4-*` |

The lead also fixed the bug p2 found: **on a portrait phone the ink contour lost its meeting lines** (caffeine drew 2 px of them against 2,028 on the desktop), because the crease noise floor grew with the canvas height and the camera distance while the depth ring stayed one texel. The floor now assumes the 24-bit depth both backends allocate, and the ring spans the same share of any picture's height. After the fix: phone 1,087 meeting-line pixels (2.75 % of the molecule; desktop 2.44 %), line width held at DPR 1 and 2, no tile seam in a 2400×1600 export (WebGL2 lane, desktop and phone390).

## Verification on the merged tree (load average 2–6)

| Check | Result |
|---|---|
| Unit tests | core 480, scene 128, ui 919, Worker 143, renderer 16: all pass, none timing out on a quiet machine |
| Typecheck | ui, scene, core clean |
| Lint | 0 errors; 36 warnings, none in core, scene, ui or the Worker (31 are in `apps/remotion-trailer`) |
| Web build | passes; the tree stays clean |
| `pnpm apple:check` | passes (the Swift generated from the TypeScript is current) |
| `tests/ui/render-artifact.spec.ts` (CI's WebGL2 lane) | 2/2 pass in 30 s; S1's timeout was the load |
| Morph and contour smoke, WebGPU lane | see the end of this file |
| V2 render-parity candidates | see the end of this file |

## Known gaps worth your eye

- **SwiftShader only**, as in S1. Every new tuning value (Chalk's strokes and grain, the ember's width and strength, the toon SVG's line weight) is a first guess.
- **The ember on light plates** (Sketch, Engrave, Halftone) has not been looked at; lime on paper may be faint.
- **The SVG drawings keep the model's ball sizes**, so carbon grows about 10 % and hydrogen about 50 % at the hand-off to 3D. Matching them means changing `drawRadius`, which the Daily and the desk models also read.
- **Replay clips on a phone**: the frame-exact path allocates render targets per frame; memory pressure on phones is unmeasured. A drifting procedural background, the selection ring and the Foil reveal still run on wall time, so a slow device shows them faster in the clip.
- **Wall-clock unit tests** (`objectFacts` "C60 under 20 ms", the scale cost bound) flake under heavy load; they pass on a quiet machine.
- **The sphere-grid local paths** are scrubbed from the screen only: `lupi.knowledge_graph`, Herdr task events, label search and the `/#/mcp` harness still carry them, and the data file's `description` field holds 1,302 more.

## Decisions waiting on you

The seven in [S1's status](../2026-10-s1/status.md#decisions-waiting-on-you) stand. S2 changes two of them:

- **(6) Sphere-grid labels**: the display is scrubbed (S2 p1); regenerating or stripping the data file is still your call.
- **Unused dependencies** are now out of the lockfile (S2 p3), so that S1 gap is closed.

## Final checks

The WebGPU-lane morph and contour smoke and the V2 render-parity re-derivation were still running when this file was first committed; their results follow in the next commit.
