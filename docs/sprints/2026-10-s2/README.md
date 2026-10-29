# Sprint S2, 2026-10-08: finish what S1 started

S1 shipped four new looks and two motions from this week's Shaders release, and the first browser QA of wave 3. Its status ([../2026-10-s1/status.md](../2026-10-s1/status.md)) lists what it left rough. S2 polishes those, takes two more Shaders ideas, and runs every local verifier on the merged tree. The split is again about 20 % creative, 30 % technical and 50 % practical, in eight tracks (one agent each, on `s2/<track>` in its own worktree), merged by the lead into `claude/nifty-volta-ophavr`.

Results land in [status.md](status.md); screenshots in [shots/](shots/).

## Tracks

### Creative (about 20 %)

| Track | What a visitor gets | Size |
|---|---|---|
| **c1-chalk** | **Chalk**, a fifth drawing that suits Lupi's dark sage plate: light chalk outlines and three hatch families that fill in as the shade deepens, broken up by chalk dust, after Shaders' Chalkboard (MIT). The contour draws in chalk too. S1 found black ink hard to read on dark plates; Chalk is the drawing made for them. | M |
| **c2-one-drawing** | **One drawing everywhere.** The ink drawings on `/m` pages, the home wall's tiles, the finder and the switcher are lit gradient balls, while the viewer's Illustrate look is toon-shaded with ink outlines, so the hand-off from a tile to the 3D view changes style mid-flight. The SVG drawings take the toon bands, catchlight and outline of the TSL look, so the relay lands on the same picture. | M |

### Technical (about 30 %)

| Track | What it does | Size |
|---|---|---|
| **t1-fuse-2** | The Light Fuse's two gaps: the post recipe (AO, glow, tone mapping) fades with the ink instead of switching at the toggle, and a thin lime **ember** burns along the front. | M |
| **t2-replay-clips** | **Frame-exact Instant Replay clips.** Today the 9:16 clip records the live canvas in real time through MediaRecorder: slow phones drop frames and the canvas resizes while it records. The clip is rendered offline instead, frame by frame from the replay tape at a fixed rate, through WebCodecs' `VideoEncoder` into an MP4 (`mp4-muxer`, already a dependency), with MediaRecorder kept as the fallback. | L |

### Practical (about 50 %)

| Track | What it does | Size |
|---|---|---|
| **p1-s1-loose-ends** | The bugs S1 found but did not fix: `/scale`'s overlapping slider labels; the arrival playing under the "Opening…" plate; a Worker error message pointing at a Node CLI that does not exist; a Vite alias to a package that does not exist; the five `react-hooks/exhaustive-deps` warnings, now checkable in a browser; the atom card showing local `/home/...` paths from the sphere-grid labels (display-only scrub until the owner decides on regeneration). | M |
| **p2-comfort-phone** | S1's new looks and motions were seen on a desktop profile at Standard comfort only. Run ink, fuse, contour, foil, morph, remix and replay on the phone profiles and with Gentle and Still, and fix what breaks. | M |
| **p3-tests-deps** | The unit tests that time out under load (`periodicTable`, `SavedViewsLibrary`, `scale.cut`): find why they are slow and fix the cause. Finish the dependency diet S1 could not (Rive, gifenc and `packages/renderer`'s unused deps; mp4-muxer stays for t2) with a networked re-lock, and drop the dead CSS S1's dead-code track left. | S–M |
| **p4-verifiers** | Run every local-only verifier on the merged tree for the first time since the port: `verify:mcp-bridge`, `verify:asset-quality`, `verify:exports` and the full `verify:dual-backend` (desktop and phone). Fix what fails, or say why it is the verifier that is wrong. | M–L |

## Rules

Unchanged from S1 ([../2026-10-s1/README.md](../2026-10-s1/README.md#rules-every-track-follows)): owner decisions win; both backends; TSL only; illustrative effects never reach an export; no new CI checks; each track ships its own local smoke and screenshots. Ported Shaders code names its source; `NOTICE.md` already carries the licence.

## Merge plan

p3 → p1 → p4 → c2 → c1 → t1 → t2 → p2, gates after each merge, then a merged-tree smoke of every S1 and S2 plugin on both backends, and the V2 render-parity candidates re-derived if a track changed a renderer-validity input.
