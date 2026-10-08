# Comfort and phone QA: S1's looks and motions on a phone and at every Motion level

Track `p2-comfort-phone`, Sprint S2, 2026-10-08. Branch `s2/p2-comfort-phone` from `9467376`.

S1 saw its new looks and motions (Engrave, Halftone, the ink contour, the Light Fuse, refinished Foil, the morph arrival) on the desktop profile at Standard comfort only. This track ran them on the 390 px phone profile, at Still (`--reduced-motion`) and at Gentle. It gave the S1 plugins a phone way in where theirs was desktop-only, and added a `comfort` plugin that chooses each Motion level in the Play tray and times the Light Fuse and the morph at it.

One viewer bug turned up: on a portrait phone the ink contour draws no meeting lines where the balls of a space-filling molecule meet. It is in the contour's depth noise floor, in another track's file this sprint, so it is described below, not fixed. Everything else on the phone and at every comfort level did what `docs/ink-and-light.md`, `docs/morph-arrival.md` and AGENTS.md say. The other failures were the smoke harness itself, mostly its waits on a machine at a load average of 40 to 70; those are fixed. The WebGPU lane at DPR 3 was too slow on that machine to finish a phone run, so the phone results here are the WebGL2 lane at DPR 2.

## How it ran

- **Builds:** `pnpm --filter @atlas/web build` at `9467376` for the first runs, and again after `eca6bc6` (which adds `__lupiPlay.state().motion.feel`, read by the comfort plugin). The smoke tool serves `apps/web/dist` through `tools/serve-web.mjs`.
- **Lanes:** headless Chromium on SwiftShader with `--strict-backend`. `webgl` is three's WebGPURenderer on its WebGL2 backend, where a phone's canvas is capped at DPR 2 (780×1688 on phone390). `webgpu` is the same renderer on SwiftShader WebGPU at DPR 3 (1170×2532). Every run rendered through the backend its lane names.
- **Profile:** `phone390` (390×844, DPR 3, touch, iPhone 13 user agent), plus `desktop` for two baselines. The Pixel 7 `phone` profile was not run.
- **Comfort levels:**
  - Standard: no flag.
  - Still from the OS: `--reduced-motion`, with nothing stored.
  - Standard, Gentle and Still chosen in the Play tray's Motion row inside one page: the `comfort` plugin.
- **Machine:** 4 shared CPUs at a load average of 18 to 73 (eight tracks' builds, unit tests and browsers). The WebGL2 lane at phone390 drew a frame every 4 to 19 s. On the WebGPU lane one frame took long enough that a CDP screenshot timed out at 120 s.
- **Command:** `node tools/verify-viewer-smoke.mjs --scenarios=<name> --backend=<lane> --profile=phone390 --strict-backend [--reduced-motion] --timeout=120000`, one plugin per run, at most two runs at once.
- **Screenshots:** in the phone lanes CDP returns screenshots at CSS size (390×844), downsampled by the browser. So every measurement here is in CSS px, and patterns at the device's own pixels were not seen.

## Results

Counts are the plugin's checks passed of checks run in the attempt named; the tool retries a failed scenario once.

| Plugin | Comfort | WebGL2 lane, phone390 (DPR 2) | WebGPU lane, phone390 (DPR 3) |
|---|---|---|---|
| `comfort` | Standard, Gentle, Still in the tray | **33/33** | stopped: a frame every 15 s or more; the 22 s fuse could not be seen end to end in 120 s |
| `fuse` | Standard | **35/36**: every check on the phone; only the mid-fuse export timed out at its own 45 s (load) | not run |
| `fuse` | Still | C60 part **5/5** (cut both ways, references match, no frames after); stopped before caffeine | not run |
| `morph` | Standard | **16/16** | not run |
| `ink` | Standard | **46/46** | stopped |
| `contour` | Standard | 28/30: **meeting lines missing** (bug 5); outer contour width right | stopped: canvas capture timed out at 120 s |
| `sheets` | Still | 60/61 and 59/61 before the capture fix (bug 1); 59/61 and 60/61 after it (sheet-close waits of 8 s, bug 4) | **61/61** (twice) |
| `remix` | Still | 22/23: "a roll starts a morph" failed because Still cuts, as it should; the plugin now checks the cut | stopped (a tap timed out at 30 s, bug 2) |
| `foil`, `replay` | Standard, Still | not run | not run |

### The comfort plugin on the phone (WebGL2 lane)

| Level | Light Fuse (tray Ink, then Lit), pace ×20 | Morph through the Switch sheet | Quiet Idle |
|---|---|---|---|
| Standard | Both burn along the bonds (`mode 'graph'`). The front read 0.833 at the frame that ended 14.8 s after the start frame. | C60 → caffeine: `feel { duration 0.9, weight 1 }`. Still morphing after 900 ms of the motion clock, landed by 1,000 ms (11 drawn frames, 78 s of wall time). | 0 frames |
| Gentle | Both burn along the bonds at the same pace: 0.893 at 17.0 s, 0.759 at 11.4 s. | caffeine → benzene: `feel { duration 0.55, weight 0.5 }`. Still morphing at 500 ms, landed by 600 ms (7 drawn frames). | 0 frames |
| Still | No fuse and no fade: the look cut between two frames, both ways. | benzene → water: no arrival at all, display motion never live; the molecule cut in. | 0 frames |

- **Fuse readings:** a fuse runs 22 s (`INK_FUSE_MS` 1,100 ms × the smoke pace 20). Each reading sits where a 22 s front would be, once the start frame's own drawing time (2 to 4 s, while the contour pass is built) is allowed for.
- **Morph timing:** the morph's clock steps at most 0.1 s per drawn frame (`MAX_STEP_S`). On a slow machine a morph therefore lasts a number of frames, not of seconds, and the frame count is what the check reads.

## Bugs

| # | Bug | Reproduction | Status |
|---|---|---|---|
| 1 | Smoke: under `prefers-reduced-motion` a canvas capture showed the Play pill. The app's reduced-motion CSS gives every property, visibility included, a 1 ms transition, and the capture ran in the frame that started it. `sheets` then read the pill as part of the molecule ("the molecule returns" failed at Still). | `--scenarios=sheets --backend=webgl --profile=phone390 --reduced-motion`: the drawn box alternated between `[26,310,321,752]` and `[67,310,321,536]` with no frame drawn between. | Fixed in `676df85`: `captureCanvas` waits two animation frames after hiding the chrome. The check has passed since. |
| 2 | Smoke: page actions (`boundingBox`, `tap`) kept Playwright's 30 s default while every other wait took `--timeout`, and a SwiftShader shader compile held the main thread longer. | `ink` on phone390, WebGL2 lane, switching to Sketch: `locator.boundingBox: Timeout 30000ms exceeded`. | Fixed in `6d2dbb2`: the page's default timeout is `--timeout`. |
| 3 | Smoke: when a frame comes every few seconds, two screenshots 250 ms apart match whether or not the change has been drawn. `contour` captured space-filling caffeine still lit. | `contour` on phone390, WebGL2 lane, at `9467376`: both captures of the pair were lit. | Fixed in `7fb3e4d`: `contour` waits for the drawing at rest with the frame loop asleep (`frameDemand.awake` false). The rest waits in `ink`, `fuse` and `comfort` also require the loop to be asleep. |
| 4 | Smoke: waits of 4 to 15 s were too short at a load of 45 to 70 for the atom card, the Play tray, a sheet opening or closing, and a shading coming to rest. | `fuse` at Still: "tapping an atom opens the atom-info card - no card after 8 attempt(s)". `sheets` at Still: "Style: closing hides the sheet" failed although its occluder had gone. | Fixed in `093d9b3`, `0b16af1` and `51bf3b4`: 12 s per atom candidate, 30 s for trays and sheets, 90 s for a shading. |
| 5 | **Viewer: no meeting lines on a portrait phone.** The ink contour draws no crease lines where the balls of a space-filling molecule meet: 2 px of them on caffeine against 2,028 on the desktop. The outer contour is drawn. | `/?sim=caffeine` at 390×844, DPR 2, then `lupi.set_viewer { inkStyle: 'flat', backgroundPreset: 'sage-plate', atomScale: 2.6, showBonds: false }`. Compare with `&contour=0`. | **Not fixed**: `packages/ui/src/postprocess/inkContour.ts` is track t1's file this sprint. Diagnosis below. |

### Bug 5: the contour's depth noise floor on a phone

In `inkContour()` (`packages/ui/src/postprocess/inkContour.ts`), a crease is the inward turn of the depth slope across a ring of `radius` texels. The code subtracts four times the depth buffer's grain from it:

```ts
const grain = select(ortho, ..., zc.mul(zc).div(max(near, 1e-6).mul(steps))).div(footprint);
const turn = slopes[a].add(slopes[c]).negate().div(span).sub(grain.mul(4));
```

- **Where it grows:** the grain is `zc² / (near × 2²²)` world units, and the ring's `footprint` is `zc × radius / (|P₁₁| × height / 2)`. In slope units the floor therefore grows with the camera's distance and with the canvas's height in device pixels.
- **Why a portrait phone loses the lines:**
  - The camera fits the molecule's width, so it sits twice as far from caffeine: 28.3 Å against 14.1 Å on a 1024×640 desktop.
  - The canvas is 1688 device px tall, against 640.
  - The ring stays at one texel (`round(innerPx × 0.6)` with `innerPx` 2.2).
  - `cameraNear` is 0.025, so the depth grain is coarse to begin with.
  - Together the floor is about five times the desktop's, and it swallows the crease's 0.22 to 0.6 band.
- **Measured** (inked meeting-line pixels inside the silhouette, contour on against `?contour=0`, WebGL2):

| View | Camera distance × canvas height (device px) | Meeting-line pixels |
|---|---|---|
| desktop, fit (14.1 Å) | 9,000 | 2,028 |
| desktop, 2.2× farther (31 Å) | 19,800 | 271 |
| phone390, 0.45× closer (12.7 Å) | 21,400 | 922 |
| phone390, fit (28.3 Å) | 47,800 | **2** |

- **Fix, first guess for t1** (one or more of these):
  - Lower the safety factor: `grain.mul(4)` against `depthSteps: 2 ** 22` is sixteen times one 24-bit step.
  - Widen the ring with the device pixel ratio, so its footprint stays a CSS pixel.
  - Raise `cameraNear` (`useViewerSceneModel.ts`, `cameraDistance × 0.002`), which sharpens the depth grain everywhere.

  Each needs a look on both backends for false creases on smooth balls.

## What the plugins check now

- **`comfort`** (new; desktop and phone390): described above. It reads `__lupiPlay.state().motion.feel`, a new read-only field (`eca6bc6`) that reports the live arrival's `{ duration, weight }`. A software renderer cannot time a 0.55 s morph from the screen.
- **`fuse`:**
  - On a phone: the tray's Ink and Lit instead of `I`, and a tap on the hero. The atom is picked first: the atom card makes room, so the references and the fuse are drawn under its view inset.
  - At Still: the toggle cuts both ways, the end matches the ink view, and the hero opens C60 lit with no Ink-to-Light.
- **`morph`** on a phone: the deck's Switch sheet, which stays open, so the morph plays under the sheet's view inset.
- **`replay`:**
  - On a phone: a touch flick and taps.
  - At Still: `replay('moment')` gives a still tape (one key, no events), and the link opens C60 at that pose without playing ("Shared view · your turn").
- **`remix`** at Still: a roll cuts to its code, exact, with no morph.
- **`ink`** on a phone: the live views and the Engrave and Halftone close-ups. Its exports stay on the desktop: an export's spec and pixels do not depend on the device that asks.
- **`contour`:**
  - Step 5, desktop and phone: the outer contour's width.
  - Its exports stay on the desktop.
- **`foil`** lists phone390; nothing in it was desktop-only.
- **`sheets`** waits longer; nothing else changed.

## Line weight and patterns at the phone's DPR

- **The ink unit.** It is `uInkPx = pixelRatio × clamp(shortSide / 900, 0.85, 2.6)` device px. The short side is 640 CSS px on the desktop and 390 on phone390, so both are at the 0.85 floor. An ink unit is therefore 0.85 CSS px at DPR 1, 2 and 3.
  - Atom line (1.5 units): 1.28 CSS px.
  - Outer contour (2.6 units): 2.21 CSS px.
  - Hatch spacing: 3.7 CSS px.
  - Engraving spacing: 3.4 CSS px.
  - Halftone pitch: 4.8 CSS px.
- **Measured.** The outer contour's width at half its depth across the molecule's edge was 4.17 CSS px at DPR 1 (desktop) and 3.26 CSS px at DPR 2 (phone390), both on WebGL2. Both are 2.21 CSS px plus about one canvas pixel of soft edge on each side (FXAA and coverage): 2.21 + 2 at DPR 1, and 2.21 + 1 at DPR 2. The line keeps its CSS width across DPRs. A missing or doubled DPR factor would have measured about 1.1 or 4.4 CSS px at DPR 2. `contour` step 5 checks this, at 2.21 + 2 / DPR ± 25 %.
- **Patterns.** At DPR 2 the engraving's period is 6.8 device px and the halftone's 9.5; at DPR 3 they would be 10.2 and 14.3. All are far from the 2 px a pixel grid can hold, so a phone's display should show no moiré from the render itself. The desktop at DPR 1, with a 3.4 px engraving period, is the tighter case. At CSS size on the phone (screenshot `p2-comfort-phone-engrave-halftone-c60-phone390-webgl2.jpg`), the engraving's lines and the halftone's dots are clean. The device-pixel view itself is unseen: CDP returned CSS-size screenshots in these lanes.

## Seen for the first time

- The Light Fuse on a phone: from the tapped atom along the bonds under the atom card's view inset; held at 0 to 0.8 for a filmstrip; ending lit. Ink-to-Light from the home hero on a phone.
- Gentle and Still for the fuse and the morph, chosen in the Play tray:
  - At Gentle the fuse keeps its pace, and the morph halves its travel and lasts 0.55 s.
  - At Still both cut.
- The morph under an open phone sheet (Switch), with the molecule in the band above the sheet. An export taken mid-morph on the phone has the `artifactDigest` of one taken at rest.
- Engrave and Halftone on a phone, and the phone sheets and Remix at Still.

## Observed, not bugs

- **The Play tray makes room, then gives it back during the fuse.** On a phone the tray declares the area it covers, and once it has been open longer than its linger, the molecule moves up. Choosing Ink closes the tray, so the molecule glides back down during the first half second of the Light Fuse. A frame of the phone fuse caught it mid-way: the `fuse` timeline row "lit 77 % ink 1 %" is the picture moving, not the look.
- **Ink is heavier on a phone, relative to the picture.** An ink unit never drops below 0.85 CSS px (`minPictureScale`). On a 390 px phone the lines are therefore about twice as heavy, relative to the picture, as in a 1,024 px export, which scales them with the picture. The floor keeps phone lines from going thin; whether the weight is right is a call for a real phone.
- **The morph's length is in frames on a slow device.** The display-motion clock steps at most 0.1 s per frame, so at a frame every 5 s the 0.9 s morph takes 10 frames, about 50 s. At 60 fps it is 0.9 s.

## Still not seen

- **The WebGPU lane on a phone** past the first steps: SwiftShader WebGPU at DPR 3 (1170×2532) was too slow on this machine. DPR 3 itself is unseen; DPR 2 (WebGL2) is.
- **The device's own pixels:** CDP gave CSS-size screenshots in the phone lanes.
- **The Pixel 7 `phone` profile** (DPR 2.625) for the looks.
- **Plugins not run:**
  - `foil` and `replay` on the phone.
  - `replay` and `morph` at Still.
  - `fuse` at Still past C60.
  - `comfort` on the desktop profile.
- **As in S1:** real devices, real GPUs, sheet drags and landscape.

## Screenshots

In `shots/`:

- `p2-comfort-phone-engrave-halftone-c60-phone390-webgl2.jpg`: C60 in Engrave (left) and Halftone (right) on the 390 px phone, close up (WebGL2, DPR 2).
- `p2-comfort-phone-fuse-filmstrip-phone390-webgl2.jpg`: the Light Fuse on the phone from the tapped atom (lime ring), held at 0, 0.2 … 0.8, then lit.
- `p2-comfort-phone-morph-c60-caffeine-phone390-webgl2.jpg`: C60 → caffeine on the phone through the Switch sheet (the sheet hidden): before, the switch, two morph frames, landed.
- `p2-comfort-phone-contour-fit-vs-closer-phone390-webgl2.jpg`: bug 5. Space-filling caffeine in Illustrate on the phone: at the fit (left) no meeting lines; 0.45× closer (right) they are drawn.
- `p2-comfort-phone-capture-fix-before-after-phone390-webgl2.jpg`: bug 1. Two "chrome hidden" captures of the same still view at Still: before the fix (left) the Play pill shows through; after it (right) only the canvas.
