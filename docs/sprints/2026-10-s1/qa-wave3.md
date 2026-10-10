# Wave 3 QA: the first browser run

Track `p1-wave3-qa`, Sprint S1, 2026-10-08. Branch `s1/p1-wave3-qa` from `162810b`; the fixes are `bb83110`, `40b309a`, `1fbe064` and `3217925`.

Wave 3 ([wave3-status.md](../../brainstorm/2026-09-viewer-play/wave3-status.md)) had never run in a browser. Four local smoke plugins now drive Remix codes and Foil, Instant Replay, the phone sheets and the zero-canvas pages (`/m`, Lupi Daily, `/scale`, `/play`). They confirmed the three known bugs and found a fourth; all four are fixed.

## How it ran

- **Builds:** `pnpm --filter @atlas/web build` at `1fbe064` for `remix`, `replay` and `sheets`, and at `3217925` (the Daily fix, CSS only) for `pages`. The smoke tool serves `apps/web/dist` through `tools/serve-web.mjs`.
- **Lanes:** headless Chromium 1194 on SwiftShader with `--strict-backend`. `webgl` is three's WebGPURenderer on its WebGL2 backend; `webgpu` is the same renderer on SwiftShader WebGPU. Every run rendered through the backend its lane names.
- **Profiles:** `desktop` (1024×640), `phone` (Pixel 7) and `phone390` (390×844, DPR 3, touch).
- **Machine:** 4 shared CPUs at a load average of 9 to 28. Frames took up to 20 s each on the WebGPU lane, so the plugins wait on state rather than time wherever they can.
- **Command:** `node tools/verify-viewer-smoke.mjs --scenarios=<name> --backend=both --profile=<profiles> --strict-backend`, one plugin at a time.

## Results

| Plugin | Profiles | WebGL2 lane | WebGPU lane |
|---|---|---|---|
| `remix` | desktop, phone390 | 23/23, 23/23 | 23/23, 23/23 |
| `replay` | desktop | 13/13 | 13/13 |
| `sheets` | phone, phone390 | 61/61, 61/61 | 61/61, 61/61 |
| `pages` | desktop, phone390 | 44/44, 44/44 | 44/44, 44/44 |

All 14 runs pass: 538 checks, no uncaught error and no console error.

- **First pass.** The first full pass at `1fbe064`, at a load of 20 and more, passed `sheets` and `pages` outright. `remix` failed 5 checks and `replay` 4, all of them the plugins' own waits: a 10 s wait for a morph whose colour swap took a 20 s frame on WebGPU, a picture-change threshold that a roll onto the near-sage Gallery Studio plate cannot meet, and a 45 s wait for a replay that took 4 minutes on WebGPU (see the notes). The waits were raised and the picture change is now logged, not judged; the table is the rerun.
- **Before the fixes.** `remix` on the pre-fix build failed 4 of 24 checks on WebGL2 desktop: the camera and atom-scale checks (bug 2) and the two Foil-under-ink checks (bug 1). `pages` with its phone layout checks failed 3 of 44 on WebGL2 phone390 (bug 4).

## Bugs

| # | Bug | Reproduction | Status |
|---|---|---|---|
| 1 | The Play pill named a Foil finish that the Illustrate look hides: a "✦ Holo foil · r1-…" flash and a "✦ Holo" chip while ink was on. | `lupi.set_viewer { inkStyle: 'flat' }`, then `__lupiPlay.remix('r1-K03DQ')`. | Fixed in `bb83110`: under ink the code flashes as a plain Remix, and the chip waits for the light. Unit test `remix/actions.test.ts`; `remix` step 6. |
| 2 | `lupi.export_asset` moved the live camera to its front fit (under 5,000 atoms) and left its 1.8 atom-scale boost behind (under 200 atoms). | `/?sim=caffeine`, bonds off, iso preset, `lupi.export_asset { format: 'png' }`: the rig went from the iso pose to `[0.54, -0.02, 13.8]`, `atomScale` from 1 to 1.8. | Fixed in `40b309a`: the fit lives only in the spec's camera, which the capture already copies, and the atom scale is put back after the export. Specs are unchanged. `remix` step 4. |
| 3 | A deep link drew the header ("Lupi · Molecule viewer · Account") over the full-window "Opening…" plate before the molecule's file landed. | `/?sim=caffeine`, recording every frame: the header sat on the plate for 136 ms (desktop) to 388 ms (390 px phone). | Fixed in `1fbe064`: the header arrives with the molecule. `pages` step 4 (0 of 13 to 45 plate frames). |
| 4 | Lupi Daily on a phone: the disc drew at 167 px against the left edge, and the Guess button ran 25 px past a 390 px screen, so the page scrolled sideways. The same on `/daily/` and `/daily/text`. | `/daily/2026-10-08` at 390×844: page 415 px wide, disc 95 px off centre. | Fixed in `3217925`: the phone column stretches and the guess box may narrow. The disc is now 358 px and centred. `pages` step 2. |

## Found, not fixed

- **`/scale` slider labels overlap** at the ion end: the last four landmark labels, down to "1 ion", print over each other at 1024 px and at 390 px. Dropping a landmark label that would touch its neighbour, in `scale/ScaleShell.tsx`, would fix it.
- **The arrival plays under the plate on a slow device.** The pill reads "Illustrative · Reset" from the moment the arrival is armed, while the "Opening…" plate still covers the canvas. On SwiftShader the first-frame mark came 7.6 s (desktop) and 12 s (phone) after the file, past the arrival's 4.5 s release fallback, so the arrival played unseen. This is PlayLayer's arrival (track t3).
- **Ink on a dark Remix plate.** Under a dark Remix backdrop the Illustrate look's black outline is hard to see at the silhouette (judged from one screenshot; tracks c1 and t2).

## What the plugins check

- **`remix.mjs`** (desktop, phone390): a tray roll lands an `r1-` code that the pill flashes and that changes the look; `remix('roll')` morphs and ends exact; `r1-K7QDM` settles exact and the view then draws no frames for 3 s (Quiet Idle); an MCP PNG of the remixed view keeps the live camera and atom scale; undo steps back; a Holo code under ink names no finish, and its chip returns with the light; `?remix=r1-K7QDM` reopens with the same style fields and leaves the address bar.
- **`replay.mjs`** (desktop): a mouse flick on C60 offers "Replay ↗"; `replay()` returns the moment with a `replay=` link of 114 to 126 bytes; the share sheet shows the same live link; the link opens C60, drops `replay=` from the address bar, autoplays (pending, waiting, playing, done) with the camera moving, and ends on "Your turn · flick it".
- **`sheets.mjs`** (phone, phone390): Learn, Style, Data, Camera, Export and Switch from the deck, and Settings from the Play tray, each declare an occluder, move the molecule above the sheet and give it back on close; the canvas never resizes (CSS box, drawing buffer, ResizeObserver).
- **`pages.mjs`** (desktop, phone390): `/m/`, `/m/caffeine`, `/m/c60_buckyball`, `/m/aspirin`, `/daily/` and today's `/daily/<date>` load with no error, make no `<canvas>` and no GPU context, and draw their ink in SVG; the Daily fits the screen; one wrong guess (Acetylene) is listed with its warmth and opens clue 2; `/scale` loads; `/play?sim=c60_buckyball` opens C60 without the header over the plate.

## Seen for the first time

- Remix codes roll, morph, undo and travel by link on both backends, and a Foil code shows its finish and chip.
- Instant Replay end to end on both backends: the offer, the link, the share sheet, autoplay on the receiving side and "Your turn".
- Every phone sheet makes room for the molecule and gives it back, upright, on both phone profiles.
- `/m` and `/daily` keep the zero-canvas promise, and the Daily takes a guess.

## Still not seen

- Real devices: iPhone Safari, Android Chrome, a laptop GPU. Everything here ran on SwiftShader at a few frames a second.
- Motion Gentle and Still (no `--reduced-motion` run), sheet drags (Peek, Half, Full, a flick, a swipe to close), landscape sheets, the keyboard lift and shake to roll.
- The replay clip's picture: the sheet reports an MP4 clip ready, but its preview stays blank in this Chromium, which likely lacks an H.264 decoder. Toy moments (Tug, Burst, Heat) as replays, and replays under ink.
- Lupi Daily past the first guess: solving, the bloom, "Open in 3D", stats, the share text.
- Ink tiles and Ink-to-Light from the home page, and the Illustrate look's shading (other tracks' work this sprint).

## Notes on SwiftShader

- A shared replay steps at most 0.1 s of tape per drawn frame (`replay/player.ts`), so below 10 frames a second it plays slower than real time. A tape recorded on SwiftShader also runs to the 8 s cap with long still stretches, because the sender drew only a few frames during the coast. On the loaded WebGPU lane one replay took 267 s to reach "Your turn"; at phone frame rates it is real time.
- The 600 ms Remix morph is timed by the wall clock, so here it can finish inside one frame; the plugin reads the morph flag in the same task as the roll. On WebGPU the frame that swaps a code's colours took up to 20 s (pipeline compiles).
- Two `@atlas/ui` unit tests (`periodicTable.test.tsx`, `SavedViewsLibrary.test.tsx`) timed out at 5 s at a load of 26 and pass when run alone.

## Screenshots

In `shots/`:

- `p1-wave3-qa-remix-holo-webgl2.jpg`: caffeine under the Holo code r1-K03DQ, the pill's "✦ Holo" chip (WebGL2, desktop).
- `p1-wave3-qa-replay-playing-webgl2.jpg`: C60 receiving a shared replay mid-play, "Shared replay · Skip" (WebGL2, desktop).
- `p1-wave3-qa-sheet-switch-phone390-webgpu.jpg`: the Switch sheet at Half, caffeine moved above it (WebGPU, 390 px).
- `p1-wave3-qa-sheet-learn-phone-webgl2.jpg`: the Learn sheet on a Pixel 7 (WebGL2).
- `p1-wave3-qa-daily-desktop.jpg`: the Daily after one wrong guess, clue 2 opening (desktop).
- `p1-wave3-qa-daily-phone390-before-fix.jpg`: the Daily on a 390 px phone before `3217925`, with the small disc and the clipped Guess button.
