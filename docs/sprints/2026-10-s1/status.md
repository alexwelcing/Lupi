# Sprint S1: status

All ten tracks of [the plan](README.md) are merged on `claude/nifty-volta-ophavr` (68 commits from `11d1f4f`; 250 files, +7,385 / −88,991 lines, most of the removal being dead code, a duplicate molecule folder and an orphan public JSON). Nothing is merged to `main` and nothing is deployed.

Everything visual was seen in headless Chromium on SwiftShader, in both backend lanes (WebGPU and WebGL2), at a frame or a few a second. No real GPU, no phone. Every tuning value in the new looks is a first guess.

## What shipped, by track

| Track | Share | Result | Screenshots |
|---|---|---|---|
| c1-print-inks | Creative | **Engrave** and **Halftone**, two new Illustrate drawings ported from Shaders (MIT). In Looks, the palette, `I`, share links (`e`, `d`), saved views, MCP `inkStyle` and every raster export. | `shots/c1-*` |
| c2-foil-refinished | Creative | **Holo** gets glitter flakes and laminate wrinkles (Shaders Holographic), **Gold leaf** mirrors a procedural studio placed where the scene's own lights are (Shaders Chrome), **Pearl** a thin-film nacre (Shaders ThinFilm). Same codes, names and odds; no clock, so a still view stays still. | `shots/c2-*` |
| t1-ink-contour | Technical | A screen-space **contour** for the Illustrate look: lines where balls meet and sticks enter balls, steps, and a heavier outer silhouette. Live and in exports (one pass at output resolution, no tile seam); `view.ink.contour` in the spec; `?contour=0` to compare. | `shots/t1-*` |
| t2-light-fuse | Technical | **Light Fuse**: Ink-to-Light and the UI's ink toggles travel from the selected (or centre-front) atom along the drawn bonds, down each stick, with a burnt-paper edge (Shaders NoiseDissolve). Spatial wavefront above 2,000 atoms; agents still crossfade; captures never see a half-fused molecule. | `shots/t2-*` |
| t3-morph-arrival | Technical | **Morph arrival**: switching molecules inside the viewer, each new atom starts where a matched atom of the old one was on screen (same element first) and flies home in 0.9 s. CPU twin exact, so labels and rings ride it. Never for MCP loads, trajectories or > 20,000 atoms. | `shots/t3-*` |
| p1-wave3-qa | Practical | Wave 3 **seen in a browser for the first time**: smoke plugins for Remix, Replay, phone sheets and the static pages (14 runs, 538 checks). Four bugs fixed: the pill naming a Foil finish under ink; an MCP export moving the live camera; the header flashing over the opening plate; Lupi Daily scrolling sideways on a 390 px phone (new). Receipt: [qa-wave3.md](qa-wave3.md). | `shots/p1-*` |
| p2-repo-hygiene | Practical | Builds no longer dirty the tree (the manifest's `generatedAt` is gone); the dead `vitest.workspace.ts`; root one-off scripts, the duplicate `popular_molecules/`, stale agent plans and tracked bytecode deleted; an orphan public JSON with 1,258 local `/home/...` paths deleted; nine root notes moved under `docs/` and `docs/archive/`. | — |
| p3-dead-code | Practical | About 4,450 lines of verified dead code out: six orphan UI components, 46 unreferenced exports, the unused WGSL atom/bond render pipelines in `packages/renderer`, a never-called legacy render path in the Worker. Lint warnings 69 → 48 in that track (47 on the merged tree), zero errors. | — |
| p4-docs-truth | Practical | README names `apps/apple` as the iPhone app and maps every workspace; AGENTS.md splits "What CI runs" from "Local only", fixes the 8 ms gate and the Remix worlds export claim; nine single-reference fixes; `apps/web/CLAUDE.md` describes the real renderer; CHANGELOG caught up from 2026-09-21 to 2026-10-05. | — |
| p5-ci-tests | Practical | CI runs the Worker tests once (not twice) and the build-test job has a 45-minute timeout; the Cloud Run fallback pins its GitHub actions by SHA; a dead actionlint filter; stale HDR network stubs out of four browser specs; the `THREE_CJS_DEPRECATED` noise gone from unit tests. No new CI checks. | — |

## Verification on the merged tree

| Check | Result |
|---|---|
| Unit tests | core 480, scene 125, ui 876, Worker 143: all pass (baseline: 477, 122, 824, 143) |
| Typecheck | ui, scene, core clean |
| Lint | 0 errors, 47 warnings (baseline 0 errors) |
| Web build | passes; two builds in a row leave the tree clean |
| Product contract, actionlint runner tests | pass |
| Looks smoke (ink, fuse, contour, foil), both lanes, desktop | PASS |
| Morph, fuse and ink smoke, both lanes, desktop | 254 checks pass; 3 fail, all on the WebGPU lane's mid-morph export, after a 60 s canvas-capture timeout while eight S2 agents held the load average near 47 on 4 CPUs. The WebGL2 lane passes every morph check, including the mid-morph export's `artifactDigest`. To re-run on a quiet machine. |
| `tests/ui/render-artifact.spec.ts` (WebGL2 lane, CI's lane) | 1 of 2 passes; the other hit the 120 s test timeout inside an export at the same load. To re-run on a quiet machine. |
| V2 render-parity candidates | Not re-derived yet: S2 changes renderer-validity inputs too, so they are derived once, after S2 merges. |

Each track also ran its own smoke plugin in both lanes before merging (counts are in each track's section of the commit history and in [qa-wave3.md](qa-wave3.md)).

## How the ten tracks went

- Ten agents ran in parallel worktrees on a 4-CPU container. Unit tests that time out at 5 s (`periodicTable`, `SavedViewsLibrary`, `scale.cut`) failed under that load in several tracks and passed alone; on the quiet merged tree every suite passes.
- Merge conflicts were all in the three ink tracks (c1, t1, t2 share the ink driver, the spec validator and the docs) and in the AGENTS.md scenario list. The lead resolved them; one was a real fix: the Light Fuse set only the hatching weight, so a fuse into Engrave or Halftone would have drawn the old shading. It now sets all three.
- t3's agent hit a session limit after its code was committed; the lead committed its docs and smoke fix and merged it.

## Known gaps worth your eye

- **Seen on SwiftShader only.** Pace, edge, line weights and finish strengths are first guesses for a real screen.
- **Contour on the sage plate** is ink on near-black: it reads as a slightly smaller molecule. It shows on paper (Sketch, Engrave, Halftone).
- **The post recipe does not wait for the fuse**: AO, glow and tone mapping switch at the toggle, so the not-yet-reached part changes slightly during the fuse's second.
- **Halftone dots and the engraving's wobble sit on the screen**, not the molecule, while it turns.
- **Gold leaf is subtle** on light-grey carbon looks; Holo strongly covers dark carbon.
- **The morph holds the old shape in the new colours** until the new file's first frame (up to 0.6 s), and stretched bonds glow lime during a long flight.
- **`/scale`'s last four slider labels overlap** at 1024 px and 390 px (found by p1, not fixed).
- **Analytics** (found by p4): lupi.live posts events to the Worker, which only logs them; `pnpm analytics:report` reads Cloud Logging, which only the old Firebase function writes, so it probably sees no lupi.live traffic since the Cloudflare cutover.
- **The sphere-grid labels the gallery uses** (`generated/lupine-wiki/sphere-grid.labels.json`) carry 3,906 local paths such as `hermes-core://config//home/alex/.hermes/SOUL.md`, and the atom card shows a shortened form of them (found by p2). Regenerating needs the external lupine-wiki checkout.
- **Unused dependencies** (Rive, mp4-muxer, gifenc, and three/@atlas/core in `packages/renderer`) are confirmed unused but still in the lockfile: the offline re-lock could not resolve.

## Decisions waiting on you

The five in [README.md](README.md#decisions-waiting-on-the-owner) stand, plus:

6. **The sphere-grid labels' local paths** (above): regenerate, strip the paths at build time, or drop that gallery entry.
7. **Analytics after the cutover** (above): ship Worker logs somewhere `analytics:report` can read, or retire the report.
