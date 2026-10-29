# The local verifiers on the merged tree

Track `p4-verifiers`, Sprint S2, 2026-10-08. Branch `s2/p4-verifiers` from `9467376` (all of Sprint S1).

AGENTS.md lists four checks that no workflow runs: `verify:exports`, `verify:mcp-bridge`, `verify:asset-quality` and `verify:dual-backend`. None had run on the whole tree since the WebGPURenderer port. All four ran here, in both browser lanes. They found one product bug, trajectory bonds missing on WebGPU since S1's morph arrival, now fixed. The other failures were two testbed cases that predate a product change, and waits sized for a GPU rather than for SwiftShader on a crowded machine.

## How it ran

- **Build:** one `pnpm --filter @atlas/web build` at `9467376` (1 min 49 s). The verifiers served `apps/web/dist` (`tools/serve-web.mjs`) except where noted. Testbed cases and the bond material changed on this branch were re-run on the Vite dev server (`--url`), which serves the branch's source, so the runs needed no second build. The gates' build at the end passed (3 min 7 s) and left the tree clean.
- **Lanes:** headless Chromium 141 (1194) on SwiftShader. `webgl2` is three's WebGPURenderer on its WebGL2 backend; `webgpu` is the same renderer on a SwiftShader WebGPU adapter. Every run rendered through the backend its lane names (`--strict-backend`, and the new backend check in the bridge verifier).
- **Machine:** 4 CPUs shared with seven other agents running their own smoke runs, builds and unit tests. The load average was 7 when the first verifier started and stayed between 38 and 86 afterwards. Everything below ran at a few frames a second at best, often one frame every few seconds.

## Results

| Verifier | Command | Result | Run time |
|---|---|---|---|
| `verify:exports` | `pnpm run verify:exports` | **PASS**, 14 of 14 | 8 s |
| `verify:mcp-bridge` | `node tools/verify-mcp-bridge.mjs --backend=<lane>` (Vite dev server, the AGENTS.md default) and `--url=` the built app | **PASS**, 18 of 18 in each lane, on the dev server and the built app | 28 s to 6 min a run |
| `verify:asset-quality` | `pnpm run verify:asset-quality` (both lanes, built app) | **PASS**, 413 of 413 (205 a lane, 3 across lanes) | 55 min |
| `verify:dual-backend` | `tools/verify-viewer-smoke.mjs --backend=<lane> --profile=<p> --strict-backend --timeout=180000`, in batches | Desktop built-ins and every testbed case **pass** in both lanes after the fixes; the desktop plugins run fail only timing checks; phone not reached (below) | 47 to 60 min a lane for the desktop built-ins |

### `verify:exports`

The headless GLB and USDZ benchmark (no browser): GLB at 10k, 100k and 500k atoms in 0.16 s, 1.05 s and 5.19 s (limits 10 s and 60 s), the 10k bonded USDZ bake into 4 merged meshes, and the 100k USDZ refusal before any per-atom geometry. Nothing to fix.

### `verify:mcp-bridge`

Loads benzene through the legacy tool, exports a 256 px PNG with bonds hidden, runs a batch of eight AI-control tools, checks the state, the share URL, the command-bus events and the `postMessage` path, against the 31-tool manifest.

- **At load 7** (the first runs, Vite dev server): 17 of 17 in each lane, 28 s (WebGL2) and 45 s (WebGPU).
- **From load 17 up**, with the new backend check, the same verifier failed in turn on its own budgets: the WebGPU export timed out at the 20 s it asked for (three runs, dev server and built app) and once more at a first raise to 90 s, and the WebGL2 `postMessage` reply missed its 8 s twice and a first raise to 30 s once. Timed by hand at load 20 to 45: a 256 px export took 33 to 54 s, and the `postMessage` reply 20 s, then 7 s, 5 s and 2 ms in a row, against 15 ms for the same `lupi.viewer_state` called directly (see "Seen along the way").
- **Final runs** (export 300 s, reply 60 s, screenshot 180 s): WebGPU 18 of 18 on the built app (5 min 8 s) and on the dev server (5 min 7 s). WebGL2 18 of 18 on the dev server (6 min 23 s) and, with `--timeout=180000` for the page to boot (it took longer than the 45 s default once), on the built app (4 min 28 s).

### `verify:asset-quality`

Caffeine (opaque and transparent PNG, the repeat-determinism pair, 1024 px PNG, JPEG and the transparent-JPEG rejection, opaque and transparent WebP, GLB, the USDZ fail-closed rejection, colour-scheme and material/lighting comparisons), aspirin PNG and a 5,000-atom copper lattice (PNG, GLB), in each lane; then the same `specId` and different `artifactKey` across the lanes.

- **First run:** the first PNG timed out at the tool's 30 s default and every later export answered "An export is already in progress" behind it (the timed-out capture keeps its lock until it finishes, as designed). Killed.
- **Second run** (300 s budget): WebGPU 203 of 205. The new Engrave pixel comparison missed its first-guess threshold (4.7 % of pixels differed, against 5 %: the molecule covers about 5 % of the frame), and the closing page screenshot timed out at Playwright's 30 s, which aborted the run before the WebGL2 lane.
- **Third run** (threshold 2 %, screenshot 180 s, lane isolation): all 413 checks pass. Engrave gets its own `specId` (`e29ea54…` against the lit `a70d76e…`) and keeps it across the lanes; WebGPU and WebGL2 report `browser-webgpu-main-thread` and `browser-webgpu-webgl2-main-thread`.

A transparent 256 px caffeine export covers the same 4,814 pixels lit and in the flat drawing (2,368 at atom scale 1.0), so the drawing keeps the export's atom-scale boost; on the slate plate its ink outline merges with the plate and the balls look smaller (screenshot).

### `verify:dual-backend`

The whole of `pnpm verify:dual-backend` (desktop and phone, every built-in scenario and plugin, both lanes) was out of reach at this load: the desktop built-ins alone took 47 min (WebGL2) and 60 min (WebGPU), and the first plugin, `camera`, 25 min a lane with its retry. It ran in batches, one process a lane, with `--timeout=180000`. S1's plugins (`ink`, `contour`, `fuse`, `foil`, `morph`, `remix`, `replay`) were left to the lead's merged-tree run, and their phone runs and `sheets` to track p2.

| Batch | WebGL2 | WebGPU |
|---|---|---|
| Desktop built-ins on the built app: `home`, `caffeine`, `c60`, `lattice`, `export`, `testbed`, `churn` (and `fallback` in the no-GPU lane) | 201 of 208 checks. Fail: `export` (timeout), `testbed` (`labels`, `play`, and `backgrounds`/`post` not ready in time) | 164 of 174. Fail: `caffeine` (drag check), `export` (timeout), `testbed` (`labels`, `play`, `bonds` lerp and its pipeline error, `atoms`/`backgrounds`/`post` not ready in time) |
| `testbed`, every case, on the dev server with this branch's fixes, `--timeout=600000` | **247 of 247**, every case ready | **255 of 255**, every case ready, and `plate` forced to WebGL2 |
| `caffeine` and `export` again with the fixed harness, built app | **pass**: `caffeine` 7 of 7 (the atom card opened on the first click), `export` 8 of 8 | **pass**: `caffeine` 7 of 7 on the retry, and on the first attempt on the dev server with `1f442b8`; `export` 8 of 8 |
| Desktop plugins other than S1's | `hero` 20 of 20 and `pages` 44 of 44 pass; `camera`, `chrome`, `first-minute` and `flick` fail on timing (below); stopped in `relay` | `camera`, `chrome` and `first-minute` fail on timing (below); stopped there |
| Phone (Pixel 7): built-ins and the same plugins | not reached | not reached |

Every lane rendered through the backend it names, and `home` kept the zero-canvas rule (no canvas, no GPU context, no three chunk) in both.

## What changed

| Commit | Kind | Change |
|---|---|---|
| `767d511` | product | **Trajectory bonds draw again on WebGPU.** S1's morph arrival (`a6d0966`) gave every bond an atom-index pair attribute; the interpolating bond program, which every trajectory with a same-order next frame uses, then needed nine vertex buffers, one more than WebGPU allows. The pipeline failed ("Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)"), the command buffers that used it were rejected, and the interpolated bond was missing: found by the testbed's `bonds` case ("bond is at the lerp" read the plate), WebGPU lane only. The morph never runs on a trajectory, so that program no longer reads the pair; the case passes in both lanes. Not looked at on a gallery trajectory in the viewer. |
| `203ddc2` | stale check | The testbed `labels` case looked for the old sky-blue selection ring; it has been lime (`#d5ef9c`) since `601fc25` (2026-10-03). |
| `8cef175` | stale check | The testbed `play` case reads blue along stretched bonds; since `30e1847` (2026-10-03) a stretched bond glows lime with its strain, which washes that blue to white. The case draws without the glow; it judges where the bonds are. |
| `da8a09d`, `29ffb07`, `45894fe` | waits | Export budgets: asset-quality, the bridge verifier and the smoke's export scenario asked for 20 or 30 s; a 256 px export took 10 s to over 90 s here. They ask for 300 s. The bridge's postMessage reply gets 60 s (it took up to 20 s: an MCP command asks for frames, and the reply waits behind them). Closing screenshots get 180 s. An exception in one asset-quality lane no longer skips the other lane. |
| `452759d`, `77e54f0`, `1f442b8` | waits | The smoke's `waitSettled` took two matching captures 250 ms apart as a settled view; on SwiftShader they could straddle no frame, show an arrival still held under the opening plate (captures hide the page), or show a frame the WebGPU canvas had not yet replaced on screen. It now also wants the frame loop asleep (or two frames drawn), no arrival armed or running and no display motion live, and waits up to 60 s. The atom-card wait after a click went from 4 s to 15 s (the card came 4 to 9 s after the click). Screenshots and waits without their own timeout take `--timeout` instead of Playwright's 30 s. |
| `29ffb07` | new check | The bridge verifier checks that the viewer renders on the lane's backend (`status().rendererBackend`); before, a WebGPU lane that fell back to WebGL2 would have passed. |
| `025f210` | new check | asset-quality exports an **Engrave** drawing (256 px PNG, both lanes) next to the lit caffeine: decodable at size, opaque, its own `specId`, materially different pixels, and one `specId` across the two lanes. |

Apart from the two testbed expectations brought up to date, no check's condition changed. The waits that grew are budgets for a slow renderer, not judgements of the picture.

## Still failing, and why

Nothing that points at the product. What failed last time, by check:

- **Timing checks under load** in the desktop plugins: `camera` ("the flick comes to rest in under 4 s": 19 to 41 s here; "a flick keeps turning after release": one or two frames were presented during the coast), `flick` (settles in under 4 s; rests face-on, 9.5° and 14.3° off, after coasts of 10 to 14 s), `chrome` (the teaching line "Drag to spin · Click an atom" was not on the pill within the plugin's 20 s wait: the arrival's "Illustrative" label only came at 34 to 40 s; "the x unlatches Poke" within 3 s), `first-minute` (the viewer's first frame came 62 to 75 s after the tap; its own exports asked for 45 s; Reset and the card checks run on short waits). Everything else in these plugins passed. They were not changed: their limits are the product's own timings (a 4 s coast, a 10 s teaching line), and loosening them would stop them saying anything.
- **`caffeine` on WebGPU** ("mouse drag rotates the view") until the last `waitSettled` change (`1f442b8`): the settled capture was taken mid-arrival (twice), and passes since.
- **Not run:** the phone profile (built-ins and the pre-S1 plugins), and the desktop plugins `relay`, `settings`, `tap` and `toys` in both lanes and `flick`, `hero`, `pages` on WebGPU. At the load of this afternoon a lane took 25 min per plugin with its retry. Run them with `--scenarios=` on a quieter machine (the commands are in the table above); the harness changes here should make the WebGPU lane's waits hold.

## Gates

`pnpm run lint`: 0 errors (warnings only, none in the files changed here). `pnpm --filter @atlas/scene test`: 125 of 125. `pnpm --filter @atlas/ui test`: 849 of 876 at a load average near 70, the 27 failures timeouts (26) and one `waitFor` that ran out (MoleculeFinder); the 17 files rerun alone with `--testTimeout=60000` pass but one, `MoleculeControls.test.tsx`, whose own 10 s timeout ran out, and which passes alone (6 of 6). None of those files changed here. `tsc --noEmit` in `packages/scene` and `packages/ui`: clean.

## Seen along the way, not changed

- **Every MCP command draws frames**, read-only ones included (`lupi.viewer_state`, `lupi.status`): `executeLupiViewerMcpRequest` asks for frames before and after any tool (Quiet Idle, "an MCP command draws its result, whatever it changed"). On a GPU that is a few milliseconds. On SwiftShader under load a reply sent by `postMessage` waited behind four frames, up to 20 s, while the same call made directly answered in 15 ms. Skipping the frames for tools that change nothing would make agents on slow devices faster.
- **Exports are slow on SwiftShader.** A 256 px PNG of benzene took 9 to 54 s on either backend depending on the load, and repeat exports were no faster than the first, so the time is in the render and the look pass rather than shader compilation. A CPU profile of the page during one export was 91 % `(program)` time, native code outside JavaScript. Not measured on real hardware.
- **WebGL2 warns about renamed TSL variables**: `lupiMotionOffset`, `lupiArrival`, `lupiMorphTexel`, `lupiSeed`, `lupiRipple`, `lupiTug`, `lupiBurst` and `lupiHeat` are "a reserved keyword or already in use" and get a `_1` suffix, because a bond calls the display-motion offset once per end (`tsl/displayMotion.ts`, `offsetFn`). Harmless; the WebGPU backend does not warn.
- **Ink drawings on a dark plate read smaller**: the Engrave export on the slate plate shows each ball's dark outline merging with the plate (the S1 status noted the same for the contour on sage). Chalk (track c1) is the drawing for dark plates.
- **On the Vite dev server** the OMol25 rows proxy (`/v1/datasets/omol25/...`) answers 500 when no Worker runs on port 8787; the page logs a console error that the bridge verifier does not count.

## Screenshots

- `shots/p4-verifiers-testbed-play-webgl2.jpg`: the testbed `play` case before (stretched bonds washed to white by the tension glow) and after (the case draws without it).
- `shots/p4-verifiers-asset-quality-engrave-both.jpg`: the lit and Engrave 256 px caffeine exports from asset-quality, WebGPU and WebGL2.

Reports and every artifact: `.verify-artifacts/s2-p4-verifiers/` (not committed).
