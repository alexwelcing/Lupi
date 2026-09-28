# Round 2 · Capture Once, Share Everywhere

[← all round-2 ideas](README.md)

## Direction notes

DESIGN SPINE. One Shot, many formats. A Shot is a molecule ref, a pose code, a look (remix) code, an optional clock and a template. Every output is derived from it, so the unfurl card, the clip's first frame, the sticker and the embed poster always agree. That consistency is what makes the loops between formats feel authored. The capture service (idea 1) owns rendering, and the share sheet (idea 2) owns activation-safe delivery. Every other idea is a loop on top.

TENSIONS RESOLVED
1. iOS transient activation vs async rendering: prepare first, deliver synchronously. This also flags two likely latent bugs in today's code: auto-copy after an awaited save, and Quick Look's `a.click()` after awaits.
2. No new storage vs shareable views: the link grammar makes catalog views anonymous and stateless. Replays and relays store inputs, not pixels, in the URL. Catalog AR files, cards and Daily videos are build artifacts in the existing static deploy. The Specimen print reuses the existing saved-view `thumbnail` field. Hosted user USDZ and cards in R2 are explicitly deferred until a cost owner signs off (proposal: the product owner, a TTL and a cap).
3. A browser-free Worker vs real cards: the build-time SVG projection that already exists (`build-student-previews`) becomes the Illustrate print voice at the edge. So v9 gets real cards now without a renderer, and R9 client prints later replace them through the same doc field.
4. Safari `VideoFrame` from a WebGPU canvas (unverified): never read the canvas. Always read back a render target into RGBA, then run an encoder ladder: Mediabunny `VideoSample` RGBA, then an OffscreenCanvas-2D sample, then GIF, then MediaRecorder on a 2D canvas as a last resort.
5. Spoilers vs sharing (the Daily): date-keyed URLs, ink-only cards and text-first results. Yesterday's bloom is the return hook.
6. Motion on `/`: the Daily bloom plays only on tap, and `/m` pages are zero-canvas SVG that stays still until touched.
7. Honesty: the illustrative mark is part of each template's grid and metadata. An ESLint boundary keeps capture and MCP export apart. Illustrative captures may include bonds precisely because they are not artifacts. Toy segments keep the in-app illustrative chip.

LOOP MAP (format to return path)
- Card: its link goes to `/m` (match frame), then 3D.
- Story clip: end frame with URL and Atom QR.
- Sticker: URL on the die-cut ring.
- Replay clip: live replay link, then 'Your turn', then a new link (relay).
- Poster: Atom QR to `/m?desk=1`, then Quick Look.
- Quick Look: `canonicalWebPageURL` shares `/m`.
- Embed: 'Open in Lupi'.
- Daily: `/d` today, and yesterday's `/m`.
Every return carries `via=` so the Ledger attributes it.

v9 NOW vs WAITING FOR R9
- Ships on v9:
  - the capture service with the WebGL adapter (raw look), which is the v9 loop export: Turntable, Breathe, Condense on `uProgress`, Gentle;
  - the share sheet and five templates;
  - Instant Replay and relays for camera, look and frame;
  - edge and build-time cards from coordinates (resvg; Satori optional);
  - `/m` pages and the sitemap (7 URLs to about 100);
  - the link grammar;
  - baked Quick Look and Scene Viewer AR with deep links;
  - Daily ink cards and CI-prebuilt bloom videos;
  - tap-to-wake embeds (sleep by reload);
  - Atom QR;
  - the Loop Ledger;
  - a 2× supersampled Specimen print;
  - day-one serving of existing thumbnails as og:image.
- Waits for R3/R6/R9: as-seen (post-processed) and Illustrate in-app captures, Specimen accumulation with DOF and AO, deformer replays, and the poster template.
Nothing in the v9 slices is new GLSL: the adapter interface is identical and only the backend changes.

SEQUENCING. Ledger → link grammar and edge cards → `/m` pages and desk → capture service with sheet (v9) → Replay → Daily, embeds, QR, relay → R9 upgrades (Specimen, as-seen).

DELIBERATELY LEFT OUT
- A share tool on the MCP bridge (artifacts stay `lupi.export_asset` only).
- C107 family-tree UI (`from=` lineage is enough until there is volume).
- C108 Shelves (could later be a URL list in the same grammar).
- C2PA content credentials (certificate management too heavy for now; PNG tEXt and MP4 metadata tags instead).
- Autoplay video on home.
- Per-share tracking ids (ratios stay aggregate).
- The path-traced tier.
- Hosted user uploads.

COORDINATE WITH OTHER DIRECTIONS. D1 (arrival and first minute: The Receiving End is its share-side twin). D2 (the atom cursor supplies Specimen focus, and the keyboard maps here assume it). D3 (R9 render-target readback and phase jobs are shared with the Export V2 work but stay a separate, non-artifact contract).

NOTHING HERE IS MEASURED. Output frame rates (30 fps for clips, 15 fps for GIF) are encoding parameters, not performance claims. Mediabunny bundle size, readback cost on tile GPUs, Worker CPU per card, Safari `deflate-raw`, `canShare` for USDZ, the iOS haptic pattern and WebGPU in cross-origin iframes are all flagged for verification.

<a id="r2-capture-share-loops-01"></a>
## The Shot: one capture service behind every share
`R2-capture-share-loops-01` · foundation · effort L · judges mean **4.2** (E5 P3 A4 Pr5 M4; champion 2, keep 3) · self-scored fun 2 / visual 3 · perf improves

> One module turns a Shot (molecule + pose code + look code + time range + template) into a labelled, ready-to-send File from a fixed-size offscreen target. The v9 adapter ships now and the v10 adapter later, so cards, loops, stickers, replays, thumbnails and embed posters stop duplicating capture plumbing.

**Framing:** problem->solution

**Builds on:** C103+C104+C105+C106+C060+C061+C112+C114 (shared plumbing), cross-cutting lesson 7

**Problem:** Round 1 produced eight share ideas, and each reinvented capture. In today's code, `captureViewerThumbnail` draws the live canvas and relies on `preserveDrawingBuffer: true`. Neither the WebGPU backend nor its GL2 fallback has that flag (v10-migration §6.2), so saved-view thumbnails go blank after the port. Video export (`ExportManager.tsx`) resizes the live canvas to 1920×1080 and records `captureStream` in real time for 5 s (`FigureExportPanel.tsx` VIDEO_EXPORT). It is landscape-only and can drop frames on slow devices. `mp4-muxer` (packages/ui, apps/web) and `gifenc` (apps/web) are declared but never imported. A `VideoFrame` taken from a WebGPU canvas on Safari is UNVERIFIED.

**Solution:**

(a) DATA MODEL. `Shot { source: {kind:'curated',id} | {kind:'saved',slug} | {kind:'local'}; pose: PoseCode; look: RemixCode|'current'; clock?: {t0,t1,fps}; driver: 'still'|'turntable'|'breathe'|'condense'|'gentle'|'replay'; template: TemplateId; alpha: 'opaque'|'transparent'; lookPolicy: 'as-seen'|'raw'|'illustrate' }`. Every format is derived from one Shot, so the unfurl card, the clip's first frame and the sticker always match.
(b) RENDER ADAPTERS behind one interface, `renderToPixels(shot, t, size) -> Promise<RGBA ArrayBuffer>`. The v9 adapter uses a `WebGLRenderTarget` plus `WebGLRenderer.readRenderTargetPixelsAsync` (present in three r184; checked in the r184 source) with a dedicated capture camera. It renders the raw scene only, because the v9 EffectComposer is not routed to the target, and the output says 'raw look'. The v10 adapter uses `RenderTarget(w,h,{type:UnsignedByteType, colorSpace:SRGBColorSpace})` plus `renderer.readRenderTargetPixelsAsync`, and works on both backends. For 'as-seen', a capture-owned RenderPipeline outputs to the target (UNVERIFIED in r186). Where that fails, it falls back to 'raw' and the template supplies the style. Illustrative captures include bonds as displayed. V1 deterministic raster fails closed on bonds, and the difference is allowed precisely because these captures are not artifacts.
(c) CLOCKING. A still is one render in a scheduler `finish`-phase job, using phases rather than numeric priorities (the reversed-order trap). A clip pauses the live loop (`frameloop='never'`) and steps `advance(t)` with a render takeover into the target, so trajectory playback, deformers and background motion all read the capture clock. The live view holds its last frame under the sheet ('holding still while it develops'). The previous frameloop is restored exactly on done or cancel. Frames stream through render, readback, encode and release, with never more than two in flight. Backpressure comes from awaiting Mediabunny `source.add()`.
(d) ENCODER LADDER, all in a worker:
- Stills: PNG or JPEG via `OffscreenCanvas('2d').convertToBlob`.
- Clips, rung 1: Mediabunny `VideoSampleSource` fed with `new VideoSample(rgbaBuffer, {format:'RGBA', codedWidth, codedHeight, timestamp, duration})`, codec from `getFirstEncodableVideoCodec(['avc','vp9','av1'])`, in MP4 so iOS and Android share targets accept it.
- Rung 2: the same, sampling from an OffscreenCanvas 2D for encoders that reject RGBA input.
- Rung 3: GIF via gifenc at 480 px and an output rate of 15 frames per second. Still frame-exact.
- Rung 4: MediaRecorder on a 2D canvas, `captureStream(0)` plus `requestFrame()`. Not frame-exact; last resort only.
The WebGPU canvas is never read directly, which settles the Safari `VideoFrame` question.
(e) FINISHING, in the worker: un-premultiply alpha; composite template type, marks and QR in 2D; write a PNG tEXt chunk ('Lupi: illustrative rendering, not a measurement artifact'); set MP4 `output.setMetadataTags({title, comment})`.
(f) OUTPUT: `Prepared {file, alt, caption, shareText, link, via, bytes}`. Delivery is a separate synchronous call (see the share-sheet idea).
(g) BUDGETS:
- Story default is 720×1280 on phones and 1080×1920 on desktop.
- Stills are capped at 2048² on phones and 4096² on desktop.
- Clips run at most 6 s.
- Peak memory is two RGBA frames plus the encoder.
- Save-Data selects 720p at 2 Mbps.
- Low Power Mode renders the same frames, only slower, because stepped frames cannot drop.
- There is always a progress ring and a Cancel button.
(h) BOUNDARY: the module lives in `packages/ui/src/capture/`. ESLint `no-restricted-imports` blocks `mcp/*` and `export/renderArtifact*` from importing it, and blocks it from importing them. Outputs carry no specId or artifactKey, and `lupi.export_asset` stays the only artifact path.

**Experience:** Desktop and phone: mostly invisible, but exports stop resizing the live canvas. Every share looks consistent across formats. While a clip develops, a progress ring shows and the viewer holds still. Cancel is always one tap. Keyboard: Esc cancels. Screen reader: an aria-live polite region announces 'Preparing clip, 40 percent' and then 'Ready'. Reduced motion: no change, because the service only renders on request.

**Tech:** three r184 `WebGLRenderer.readRenderTargetPixelsAsync` (verified in https://cdn.jsdelivr.net/npm/three@0.184.0/src/renderers/WebGLRenderer.js). three r186 `Renderer.readRenderTargetPixelsAsync` / `RenderTarget`. R3F v9/v10 `advance()` and `frameloop='never'`; v10 is alpha/canary. @pmndrs/scheduler 0.2.0 phase jobs. Mediabunny (VideoSampleSource, `VideoSample(buffer, init)`, `getFirstEncodableVideoCodec`, `setMetadataTags`; https://mediabunny.dev/guide/media-sources, https://mediabunny.dev/guide/packets-and-samples, https://mediabunny.dev/guide/supported-formats-and-codecs). WebCodecs VideoEncoder: Safari's video interfaces from 16.4, per a secondary source (https://www.testmuai.com/learning-hub/webcodecs-browser-support/). gifenc 1.0.3. OffscreenCanvas 2D in a worker. The RenderPipeline-to-RenderTarget path is UNVERIFIED.

**Backend:** mixed: v9 WebGL adapter (raw look); v10 [GPU+GL2] adapter; encoders are DOM/CPU in a worker

**Rides (v10 requirements):** R9 (shares render-target readback with Export V2 but keeps a separate, non-artifact contract), R7 (capture job phase; avoids the reversed-priority trap), R6 (as-seen pipeline), R12 (thumbnails)

**v9 slice:** The full service interface with the v9 adapter: a fixed-size WebGLRenderTarget, readRenderTargetPixelsAsync, the Mediabunny/gifenc ladder and worker compositing. It replaces `captureViewerThumbnail` and the live-canvas resize path for illustrative clips. Zero new GLSL. The v10 adapter slots in behind the same interface, so nothing is thrown away.

**WebGL2 fallback:** The same render-target readback runs on WebGPURenderer's WebGL2 backend, because readRenderTargetPixelsAsync is implemented on both. Old iPhones (iOS 17/18 on GL2, plus Low Power Mode) get smaller default sizes and prefer stills or GIF. Clips there are slower but never choppy. With no WebCodecs, the GIF rung applies.

**Where in code:** New `packages/ui/src/capture/{shot.ts, adapters/webgl.ts, adapters/webgpu.ts, encode.worker.ts, deliver.ts}`. Replaces `packages/ui/src/viewer/captureViewerThumbnail.ts`. Changes the `packages/ui/src/ExportManager.tsx` video path (`restoreAfterVideo`, the setSize/setDpr juggling) and `packages/ui/src/panels/FigureExportPanel.tsx` VIDEO_EXPORT. Dependencies: drop `mp4-muxer` and start using `gifenc` (`packages/ui/package.json`, `apps/web/package.json`). Add an ESLint boundary rule in `eslint.config.mjs`.

**Risks:**

- Scene jobs that cull or LOD against the live camera (BillionAtomBlock, sub-pixel cull tiers) must accept the capture camera, or they will render stale culling.
- Pausing and restoring the frameloop is a known bug surface in ExportManager.
- The as-seen RenderPipeline-to-RenderTarget path is unverified in r186.
- Readback cost at 1080×1920 on tile GPUs is unmeasured.
- Mediabunny's bundle size is unmeasured, so it goes in a lazy chunk loaded only when the share sheet opens.
- Encoder acceptance of RGBA input varies, hence the ladder.

**Honesty:** Every output burns in 'Illustrative rendering · lupi.live' and repeats it in metadata. Outputs have no specId or artifactKey and cannot be requested through MCP. v9 captures are labelled 'raw look' rather than pretending to match the post-processed screen.

**Judges:**

- E 5/champion: One capture service replaces eight duplicated plumbings. The v9 adapter works now: I verified WebGLRenderer.readRenderTargetPixelsAsync in r184. The v10 adapter reuses R9 readback without claiming artifact status. It correctly flags that live-camera culling (BillionAtomBlock, sub-pixel cull) must accept the capture camera. *Improve:* Pass the capture camera through every cull/LOD job. Encode in a worker. Share readback code with Export V2 but never its fingerprint or artifactKey.
- P 3/keep: One capture service is the plumbing under every show-a-friend output: invisible but needed, and L effort. *Improve:* Ship the v9 still adapter first, and defer the turntable and video drivers until Instant Replay needs them.
- A 4/keep: One Shot model with an as-seen, raw or illustrate look policy means the card, clip and sticker always match. That is the prerequisite for a coherent share voice. *Improve:* Take templates and tokens from sig-01. Default to 'illustrate' for cards and 'as-seen' for clips.
- Pr 5/champion: Round 1's lesson 7 made real. From one Shot model the unfurl card, the clip's first frame and the sticker always match, and the v9 adapter ships now. Risks: effort L, and scene jobs that cull against the live camera. *Improve:* Ship the v9 adapter with two drivers (still and turntable) and the Card template, then add others as demand shows. Keep every output labelled illustrative and outside MCP artifacts.
- M 4/keep: Render-target readback sidesteps the unverified Safari VideoFrame path, and the fallback ladder (MP4, GIF, stills) reaches old iPhones. *Improve:* Budget each target's bytes in P-11's ledger, add a stills-only rung for LPM, and pause capture rather than the whole frameloop on phones.

<a id="r2-capture-share-loops-02"></a>
## Make It Mine: prepare first, send on the tap
`R2-capture-share-loops-02` · system · effort M · judges mean **4.0** (E4 P3 A5 Pr4 M4; champion 1, keep 4) · self-scored fun 3 / visual 4 · perf neutral

> One share sheet renders the formats while you look at them, so the tap that sends is synchronous and iOS keeps the gesture. It offers six designed Illustrate templates rather than random compositions, and writes the alt text and captions for you.

**Framing:** problem->solution

**Builds on:** C104+C105+C114 (templates), C106 (card), C049 (print voice), C021 (detents), C062 (layout seed); fixes C104 and C105 per the art director and mobile judges

**Problem:** Safari rejects `navigator.share` and clipboard writes made after an `await`, because transient activation is consumed. Sharing needs a File that is already built. Lupi's save flow awaits `saveCurrentMolecularView(...)` and then calls `navigator.clipboard.writeText(...).catch(() => undefined)`, which is likely a silent failure on iOS (UNVERIFIED on device). `USDZExportHelper` awaits `requestAnimationFrame` and `parseAsync` before `a.click()`. The judges asked for designed compositions: C104's random quaternions produce weak layouts, and C105's sticker is generic without a house style. They also asked for one 'Make it mine' menu (mobile-a11y) and for Illustrate as the print voice (art director).

**Solution:**

SHEET. Opening the sheet is gesture #1. It immediately runs `capture.prepare()` for the default template at quarter size so a preview shows quickly. It then renders full size in the background, and renders other templates lazily as the user swipes to them. Send, Copy and Save stay disabled until their File exists. Their handlers call `navigator.share({files:[file], text, url})`, `navigator.clipboard.write([new ClipboardItem({'image/png': readyPromise})])` (WebKit's promise pattern) or an `<a download>` synchronously. `navigator.canShare({files})` is feature-detected; the fallback is Copy link plus Save.
SIX TEMPLATES in the Illustrate print voice. House tokens: paper #f4efe5, ink #06080d, one display serif plus one grotesk.
1. Card, 1200×630: molecule in the left 58%. The right column holds the name, formula, one facet line, the atom count and the footer 'Illustration · lupi.live/m/<id>'.
2. Square, 1080²: molecule at 62% of the short side, name bottom-left, mark bottom-right.
3. Story, 1080×1920: the top 28% is kept clear of the clock, the molecule sits in the middle third and the caption in the lower third. Clips end on a 0.6 s end frame with the URL and an Atom QR.
4. Sticker, up to 1024², transparent: a raw post-free pass, a 2D die-cut ring (white at 3.5% of size plus a 0.4% ink rim), a soft shadow and the URL in microtype on the ring.
5. Wallpaper, exactly the phone's screen size: four designed layouts (Specimen low, Floating centre, Edge bleed, Macro crop), picked by the remix code through mulberry32, and only a tiny mark.
6. Poster, desktop only: A4 at 300 dpi (2480×3508) in one target. A3 only where maxTextureDimension allows it, otherwise as tiles with guard bands cropped after post. A Swiss-layout PDF via pdf-lib, loaded lazily.
CLIP DRIVERS:
- Turntable: a periodic spin about the molecule's long principal axis, from a 3×3 covariance eigen-solve, so it is seamless by construction.
- Breathe: a math `simplex4d` circle loop on camera distance and key-light azimuth, also seamless by construction.
- Condense: C030's gas-to-molecule move on the v9 `uProgress` hook, then a hold, labelled 'illustrative transition'.
- Gentle: a 12°/s turntable, the default under reduced motion.
- Replay: see Instant Replay.
POSE RULE. Templates use the Shot's pose. If the molecule fills under 40% of the frame or its principal face is edge-on, the template tidies to the nearest C021 detent, says so ('tidied to the nearest angle'), and offers Undo.
CAPTION GRAMMAR, deterministic, in `packages/core` and shared with the Worker:
- alt = '{Look} illustration of {name} ({formula}), {atoms} atoms, seen {poseWord}. Illustrative rendering.'
- shareText = '{name} in 3D: {facet line}. {link}'
- poseWord comes from detent names ('from above the ring').
- The formula comes from `library-facts.json`, and the facet line from the fixed 46-facet vocabulary.
- User text never appears in alt, except an escaped saved-view title on saved-view cards.

**Experience:** Phone: tap Share and the sheet rises with the Card preview developing. Swipe to Story, Sticker, Wallpaper or Desk. Send opens the native sheet instantly, and 'Copy sticker' pastes into iMessage or WhatsApp. Desktop: a side panel with a template grid, Copy (a ClipboardItem PNG), Download and Poster PDF. Keyboard: the sheet is a dialog with roving-tab templates; Enter sends, and Esc closes and cancels rendering. Screen reader: each preview is an img with the generated alt. The Send button's accessible name says what will go out ('Send Story clip of caffeine, 3 seconds'). Reduced motion: clip previews show the poster frame with a 'Play preview' button, and Gentle is the default clip.

**Tech:** Web Share Level 2 (`canShare({files})`), async Clipboard `ClipboardItem` with a `Promise<Blob>` (https://webkit.org/blog/10855/async-clipboard-api/). Activation is consumed by await on iOS (https://webkit.org/blog/13862/the-user-activation-api/, https://dev.to/shibowen336/sharing-a-canvas-generated-image-on-ios-with-the-web-share-api-2j0m). pdf-lib, lazy. math `simplex4d`, `mulberry32`. The capture service.

**Backend:** DOM/CPU sheet plus the capture service (v9 WebGL / v10 [GPU+GL2])

**Rides (v10 requirements):** Capture service. R6/R9 for as-seen and Illustrate (C049) renders; on v9, templates get their voice from 2D compositing over a raw render.

**v9 slice:** The sheet, activation-safe delivery, and the Card, Square, Story, Sticker and Wallpaper templates plus the Turntable, Breathe, Condense and Gentle drivers, all on the v9 adapter with a raw render and 2D-composited type. This is the 'v9 loop export'. The poster and in-app Illustrate renders wait for R6/R9.

**WebGL2 fallback:** The flow is identical. The poster is limited by MAX_TEXTURE_SIZE and falls back to guard-band tiles. On old iPhones, stills and stickers are offered first, and Story clips fall back to GIF where WebCodecs is missing.

**Where in code:** `packages/ui/src/SavedViewButton.tsx` (`handleNativeShare`, the auto-copy after an awaited save). `packages/ui/src/export/USDZExportPipeline.ts` (`a.click()` after awaits). New `packages/ui/src/capture/sheet/*` and `packages/ui/src/capture/templates/*`. New `packages/core/src/share/caption.ts`, reading `packages/ui/src/library/library-facts.json`.

**Risks:**

- Pre-rendering costs battery, so render only the default template and the one on screen.
- Web Share file-type allowlists differ; USDZ is likely refused by Chrome.
- ClipboardItem `image/png` support is patchy in Firefox.
- A poster at 2480×3508 RGBA is about 35 MB, so it is desktop-only.
- The 'tidy to detent' rule can annoy creators, hence Undo.

**Honesty:** The 'Illustrative rendering' mark is part of every template's grid, not stamped on afterwards. Tidied poses are announced. Captions use only catalog facts and the fixed facet vocabulary, never inferred claims.

**Judges:**

- E 4/keep: 'Prepare, then send on the tap' is the correctness detail that makes iOS sharing work: awaits consume user activation, so ClipboardItem needs the promise pattern. Designed templates beat random compositions. *Improve:* Pre-render only the default template and the one on screen. Share USDZ as a Quick Look link, not a file.
- P 3/keep: Preparing the file before the tap, so iOS keeps the gesture, fixes a real failed-share moment, and the templates give choice. But it's a share sheet, not play. *Improve:* Default to one template (Story) with the others a swipe away, and offer the sheet right after a moment rather than from a menu.
- A 5/champion: The only idea that designs the outputs themselves. Six templates with a type pair, a clock-safe zone on Story, a die-cut sticker ring, seamless Turntable and Breathe drivers, and a pose rule that tidies to the nearest detent when the molecule is small or edge-on. *Improve:* Pull colours and faces from sig-01 and sig-05, with one serif across DOM and canvas. Limit wallpapers to the four designed layouts, never random compositions.
- Pr 4/keep: Preparing first and sending synchronously on the tap is the difference between an iOS share that works and one that silently fails. Designed templates keep the outputs on brand. It hosts joy-15. *Improve:* Ship three templates first and measure share_completed for each.
- M 4/keep: Activation-safe delivery (prepare first, synchronous send) is correct iOS realism, and the alt text and captions are generated. *Improve:* Pre-render only the default template and the one on screen, skip background renders in LPM, and offer a text-only share.

<a id="r2-capture-share-loops-03"></a>
## Instant Replay: send the moment, not a screen recording
`R2-capture-share-loops-03` · flagship · effort M · judges mean **4.4** (E4 P5 A4 Pr5 M4; champion 2, keep 3) · self-scored fun 5 / visual 4 · perf neutral

> Lupi keeps the last 6 s of your gestures (inputs, not pixels). One tap turns your flick, detent chain or lucky roll into a frame-exact 9:16 clip and a live link, where the recipient watches it happen in their own 3D view and then hears 'Your turn'.

**Framing:** problem->solution

**Builds on:** C003+C021 (analytic kernel), C027 (closed-form deformers), C103+C112 (clips), the playtester's Instant Replay spark

**Problem:** The playtester's top share wish is 'share what I just did'. Scripted turntables are generic, and screen recordings drop frames and capture the UI. Even a good clip is a dead end: the recipient can watch it but not touch it.

**Solution:**

RING BUFFER (6 s, about 20 KB). C003/C021's camera is an analytic spring kernel whose settle is independent of dt. So Lupi stores inputs rather than poses:
- pointer samples during a drag (30 Hz, quantized to 16 bits);
- release velocities, catches and detent targets;
- look-code changes (remix seeds) and trajectory-frame scrubs;
- on v10, toy events `{kind, atomIndex, seed, t}` for C027's closed-form deformers (ripple, burst, pluck);
- a kernel snapshot every 0.5 s, for seeking.
Replaying means re-running the kernel from a snapshot with the same inputs. Each 0.5 s it re-anchors to the quantized snapshot pose, so cross-browser trig drift (math issue #48) cannot accumulate.
MOMENT DETECTOR. A moment is a flick that coasts at least one revolution, a chain of three or more detent clicks, a remix roll kept for more than 2 s, or (v10) a burst or pluck. When the moment settles, a 'Share that' chip appears in the thumb zone for 4 s and fades, with no bounce and no loop. R opens Replay on the last 6 s at any time.
OUTPUT 1, THE CLIP. The capture service runs with `driver:'replay'` into the Story template at an output rate of 30 frames per second, trimmed to the moment ±0.5 s. A reframe rule keeps the recorded orientation and roll but re-fits distance so the molecule fills the 9:16 middle third. The clip ends on the URL end frame. Deformer segments burn in the in-app 'illustrative motion' chip.
OUTPUT 2, THE LIVE LINK. `lupi.live/m/<id>?p=<start pose>&r=<look>&replay=<base64url(deflate-raw(inputs))>`, built with CompressionStream and targeted at 1.5 KB or less. The unfurl card shows the moment's hero frame. Opening the link plays the inputs live in the recipient's viewer under a 'Shared replay' chip; any touch takes over at once. At the end comes 'Your turn' and control hands over (see The Receiving End). Local, unsaved molecules get the clip only, with 'Save to share it live'.

**Experience:** Desktop: a trackpad flick, then the chip appears. Click it for the sheet, with the clip developing and a 'Copy live link' button. Phone: a thumb flick, then the chip, then Send; iMessage receives the video with the link as text. The recipient's phone taps the link, watches your spin happen in real 3D, then it's theirs. Keyboard: R replays; Space or any key takes over during playback. Screen reader: the chip reads 'Share your last spin of caffeine'. Playback announces 'Playing a shared spin; press any key to take over'. Reduced motion: the live replay becomes a storyboard of the settle points, one still per action, with a 'Play motion' button. The clip defaults to Gentle-style framing.

**Tech:** math/time `spring.update`/`dampAngle` (analytic and dt-independent; verified at 0.1.0). math/random `mulberry32` for toy seeds. CompressionStream `deflate-raw` (Chrome 103+; Safari support for `deflate-raw` needs verifying). `getCoalescedEvents`, feature-detected. The capture service with Mediabunny.

**Backend:** DOM/CPU for camera, look and frame replays (v9); [GPU+GL2] for deformer replays on v10

**Rides (v10 requirements):** v9: none (the C003/C021 kernel). v10: R3 plus C027 closed-form deformers for toy replays, R7 for capture phases, R9 for readback.

**v9 slice:** Camera, remix and trajectory-frame replays (the flick, the detent chain, the lucky roll), with both the clip and the live link, on the v9 capture adapter.

**WebGL2 fallback:** Deformers are closed-form `f(base, t, uniforms)`, so replays are identical on GL2; atom counts drop only if the toy itself degrades. Old iPhones get 720p clips or GIF. The live link always works because it carries only inputs.

**Where in code:** New `packages/ui/src/replay/{ringBuffer.ts, momentDetector.ts, codec.ts}`. The C003/C021 kernel module (replacing `CameraFocus` lerps). `packages/ui/src/capture/*`. The Worker's `/m/:id` meta reads the `replay` param for the card pose (`apps/mcp-worker/src/index.ts`).

**Risks:**

- This depends on C003/C021 being input-deterministic.
- Drag replay fidelity depends on the pointer sampling rate.
- Deformers that use a stored buffer (tug, IK) stay excluded until their controllers are replayable.
- Long URLs look spammy in some chats, so the clip is the primary object and the link travels as text.
- A different recipient aspect changes the framing, which the reframe rule handles.

**Honesty:** Camera replays move nothing. Toy replays keep the illustrative chip in the clip and live. Playback is labelled 'Shared replay' so it can't be mistaken for a simulation. The clip's end frame says 'Illustrative rendering'.

**Judges:**

- E 4/keep: Storing inputs rather than pixels makes replays cheap and exact, and it hosts flagship-09 and flagship-10. Camera, detent and remix replays ship on v9; deformer replays wait for R3. Drag fidelity depends on the sampling rate. *Improve:* Build it on port-12's tape. Encode only on Send, and make the fragment link the zero-encode default.
- P 5/champion: The best show-a-friend loop in the set: one tap sends what I just did, and the friend watches it happen in their own 3D view and then hears 'Your turn'. Logging inputs instead of pixels makes it cheap and exact. Risks: drag fidelity, deformer replays waiting on R3, and Safari support for deflate-raw. *Improve:* Absorb flagship-09, flagship-10 and Pass the Molecule. Surface the Replay chip automatically after a detected moment: a flip caught, a chain landed, a lucky roll.
- A 4/keep: A replay re-rendered frame-exact at 9:16 looks far better than a screen recording, and it hosts fm-09 and fm-10. *Improve:* End frames use the Condense motif and the mark (sig-07). Story safe zones come from cap-02.
- Pr 5/champion: It sends the moment, not a screen recording. The live link needs no storage and ends in 'Your turn', which is the most differentiated referral loop in the set, and camera and Remix replays ship on v9. It depends on the C003/C021 kernel being input-deterministic, and Safari support for 'deflate-raw' is unverified. It hosts flagship-09 and flagship-10. *Improve:* Ship the camera-only v9 slice and measure the rate from replay_watched to your_turn before adding toy turns.
- M 4/keep: Host for FM-09 and FM-10. Storing inputs rather than pixels is light, and reduced motion gets a storyboard of settle stills with a 'Play motion' button. *Improve:* The recipient side never autoplays (CS-13's rule). Encode in a worker with a stills fallback, and show encode progress in the Send button's accessible name.

<a id="r2-capture-share-loops-04"></a>
## Pass the Molecule: replay relays with no server
`R2-capture-share-loops-04` · game · effort M · judges mean **3.0** (E3 P3 A3 Pr3 M3; keep 3, merge 1, park 1) · self-scored fun 5 / visual 3 · perf neutral

> A link that grows: each friend adds one move of up to 5 seconds to the same molecule, and the URL carries every turn. After four turns Lupi stitches the relay into one clip. No accounts, no text, no storage.

**Framing:** capability->problem

**Builds on:** new; builds on Instant Replay, C021 (detents), C062 (rolls as turns); salvages C115's pass-and-play without Durable Objects

**Problem:** Sharing is one-to-one and ends with the recipient. Round 1's multiplayer ideas (C115 co-view rooms, C117 world crystal) were parked because they need XL server infrastructure and moderation. Lupi has no social play that costs nothing to run. The observation prompts on the 12 curated molecules are read once and forgotten.

**Solution:**

RULES:
- A chain is one molecule plus up to four turns.
- A turn is up to 5 s of replay inputs (see Instant Replay), starting from the previous turn's end pose.
- Each turn gets a colour from a fixed palette of six colour-blind-safe colours. There are no names and no text, so there is nothing to moderate.
PLAY. Opening a chain link plays all turns back to back, live ('Turn 1', 'Turn 2'). Then 'Your turn (3 of 4)': you get 5 s with a ring timer. The timer can be switched off; that is the default under reduced motion and with assistive tech, where Done ends the turn. Send makes the new link. After turn 4 the chain is Complete: the link opens as a finished relay with 'Make the clip', which stitches every turn into one Story clip with turn colours and labels.
PROMPTS. A chain can carry an optional prompt from a fixed list seeded by the molecule's observation prompt in `STUDENT_COLLECTION`: 'End on the ring from above' (benzene), 'Finish looking straight at the bent side' (water), 'Most spins wins'. The game rehearses the prompt.
SIZE. Up to 1.5 KB per turn and 6 KB per chain, in a query parameter so the Worker can draw a 'Turn 3 of 4' card at the chain's end pose.

**Experience:** Phone, couch or group chat: a friend sends a video of two turns plus the link. You tap it, watch them spin caffeine live, flick three detent clicks of your own, then Send. Desktop: the same with a trackpad or mouse. Keyboard: arrows step between detents, Space flicks at a fixed velocity, Enter ends the turn. Screen reader: each turn is announced as a summary ('Turn 2, blue: two spins, stopped side-on to the ring'). The finished clip carries burned-in turn labels.

**Tech:** The replay codec, CompressionStream, the link grammar in `packages/core`, a Worker 'relay' card template, `STUDENT_COLLECTION` prompts, and the capture service for the stitched clip.

**Backend:** DOM/CPU for camera, look and roll turns (v9); [GPU+GL2] for toy turns after R3

**Rides (v10 requirements):** v9: none. Toy turns need R3 plus C027. The stitched clip needs the capture service (the v9 adapter, or R9).

**v9 slice:** A camera-only relay (flicks, detents, remix rolls), with the stitched clip on the v9 capture adapter.

**WebGL2 fallback:** Identical. Stitched clips fall back to GIF where WebCodecs is missing. Chains open on any device, because they are inputs.

**Where in code:** New `packages/ui/src/replay/chain.ts`. `packages/core/src/share/linkGrammar.ts`. A relay card in `apps/mcp-worker/src/index.ts`. Prompts from `packages/ui/src/gallery/studentCollection.ts`.

**Risks:**

- 6 KB URLs look spammy or get truncated in some apps, so the clip is the primary object.
- Float drift across four turns is handled by re-anchoring every turn.
- Chains on saved views need public or unlisted views.
- Four turns may feel too few or too many; this is a playtest question.

**Honesty:** Turns are camera, look and roll play, labelled 'relay'. Toy turns keep the illustrative chip. No identity or user text travels. The prompt asks for observations, not properties, matching the collection's own rule.

**Judges:**

- E 3/keep: Cheap once replay exists, and a nice pass-and-play salvage with no server. 6 KB URLs get truncated or look spammy, and float drift across turns needs re-anchoring. *Improve:* Ship it after capture-03 proves replay determinism, with the stitched clip as the primary object.
- P 3/merge: A link that grows is clever, but a turn of 'up to 5 s of rotation' has no goal; it's an exquisite corpse without a canvas. Host: R2-capture-share-loops-03. *Improve:* Make it phase 2 of Instant Replay, with toy turns (pop a pattern, pluck a mode) that give each turn an intent.
- A 3/keep: Six colour-blind-safe turn colours and a stitched clip. Its visual contribution is moderate. *Improve:* Turn colours become tokens, and the stitched clip uses cap-02's templates.
- Pr 3/park: A clever social chain with no storage and no text to moderate. But it is a game stacked on a loop that isn't yet proven, and 6 KB URLs look spammy or get truncated. *Improve:* Revisit once Instant Replay shows its reply rate.
- M 3/keep: The turn timer is off by default under reduced motion and assistive technology, which is thoughtful. But playing a chain of strangers' flicks back to back is a lot of uncommanded motion, and 6 KB URLs get truncated. *Improve:* Play each turn on tap, use a storyboard under reduced motion, and make the stitched clip the primary object.

<a id="r2-capture-share-loops-05"></a>
## Unfurl Everything: molecule cards from coordinates, before the port
`R2-capture-share-loops-05` · share-loop · effort M · judges mean **4.0** (E4 P3 A4 Pr5 M4; champion 1, keep 4) · self-scored fun 2 / visual 4 · perf improves

> Every Lupi link unfurls as its own molecule in the Illustrate print voice. The browser-free Worker draws it from the saved view's coordinates and camera, and the catalog's cards are prerendered at build, each with generated alt text. The v9 product gets real cards months before R9.

**Framing:** problem->solution

**Builds on:** C106 (its v9 slice, designed), C049 (print voice), C062 (codec); the product steward's 'Satori card from coordinates first'

**Problem:** Every link unfurls with the same `/og-lupi.png`: it is `DEFAULT_SOCIAL_IMAGE` in both `apps/mcp-worker/src/index.ts` and `functions/src/socialMeta.ts`. imageAlt is always '{title} in the Lupi molecular viewer.' Saved views already store a 320×200 JPEG `thumbnail` in the Firestore doc, but `buildSavedViewShareModel` ignores it. Client-captured cards wait for R9, and the Worker is intentionally browser-free.

**Solution:**

A PRIORITY CHAIN per link, cheapest real card first.
0. DAY ONE (about 30 lines). If the saved-view doc has `thumbnail.dataUrl`, serve it at `/card/view/:slug.jpg` (decode the base64 to bytes, with cache headers) and point og:image at it. 320×200 is small but a real picture (verify each platform's minimum).
1. BUILD-TIME CATALOG CARDS. `tools/build-student-previews.mjs` already projects shipped coordinates into deterministic SVG. Lift its projection into `packages/core/src/illustrate/projectSvg.ts`, using the viewer's perspective, fov and radius rules and depth-sorted circles with ink strokes. The Goodsell/QuteMol contour falls out of painter's order: each atom's ink rim shows only where it borders farther atoms. Compose the Card template in SVG and rasterise with resvg in Node to static `/og/m/<id>.png` for the 72 curated molecules.
2. EDGE CARDS for saved views and parameterised links, at `/card/view/:slug.png` and `/card/m/:id.png?p=&r=`.
- Coordinates: curated XYZ through the ASSETS binding, or the doc's inline XYZ (up to 5k atoms; at most 2k drawn at the edge).
- Projection: the saved camera, or the `p` pose code.
- Palette: decoded from the `r` remix code with C062's integer-exact codec in `packages/core`, so edge and viewer agree.
- Rendering: SVG to PNG through resvg-wasm with a static WASM import. Satori is optional, used only if text needs flex layout; card text sits in fixed slots and can be pre-shaped.
- Caching: the Workers Cache API keyed by (slug, updatedAt, templateVersion) or (id, p, r).
- Huge URL-source views get a type card (name, atom count, element strip) with the stored thumbnail inset.
3. AFTER R9. Specimen Camera prints replace the edge SVG for saved views by writing a 600×315 JPEG of at most 60 KB into the existing `thumbnail` field. Step 0 then serves it.
og:image:alt comes from the caption grammar, with og:image:width and height and a JSON-LD image.

**Experience:** Anyone pasting a Lupi link into iMessage, WhatsApp, Slack, Discord, X or LinkedIn sees that molecule, at that angle, in that look's palette, with its name and formula, instead of the brand card. Screen-reader users in chat apps that expose alt text hear 'Illustration of caffeine (C8H10N4O2), 24 atoms, seen from above the ring. Illustrative rendering.' Nothing changes inside the viewer.

**Tech:** @resvg/resvg-js at build and resvg-wasm at the edge (static WASM import; pitfalls in https://dev.to/devoresyah/6-pitfalls-of-dynamic-og-image-generation-on-cloudflare-workers-satori-resvg-wasm-1kle). Satori is optional; it is pinned to 0.15.x in reports because of a harfbuzzjs `location.href` issue on Workers. Worker bundle growth of about 0.5-0.9 MB gzipped is reported (https://github.com/corvmc/corvmc.org/issues/1474). Workers Cache API. A shared projection in `packages/core`.

**Backend:** DOM/CPU (edge Worker and build; no GPU, no browser)

**Rides (v10 requirements):** none (v9); R9 only for the client-captured upgrade

**v9 slice:** All of steps 0-2. Step 3 arrives with the Specimen Camera.

**WebGL2 fallback:** Not applicable: recipients on any device, including no-WebGL, see the same PNG.

**Where in code:** `apps/mcp-worker/src/index.ts` (`buildSavedViewShareModel`, `DEFAULT_SOCIAL_IMAGE`, `renderSavedViewShareHtml`, new `/card/*` routes). `functions/src/socialMeta.ts` (duplicate share HTML: pick one owner). `tools/build-student-previews.mjs` becomes a `packages/core` illustrate module. `packages/ui/src/seo-routes.json` images.

**Risks:**

- Worker CPU on uncached renders. Mitigations: a bounded atom count, the cache, quantized pose codes to shrink the key space, and a rate-limit binding.
- WASM static-import pitfalls on Workers.
- Fonts must be bundled, never fetched.
- The print voice will differ from in-app lighting. That is intentional but must be art-directed.
- Share HTML is duplicated today between Cloud Functions and the Worker.

**Honesty:** Cards say 'Illustration' and are drawn from shipped or saved coordinates; the Worker never invents a pose or look the link doesn't carry. The type card for huge views says it is a summary, not a render.

**Judges:**

- E 4/keep: Real cards months before R9. Serving the existing thumbnail dataUrl on day one and prerendering catalog cards at build cost no edge CPU. resvg-wasm inside a Worker has unverified bundle-size and CPU limits for uncached saved-view renders. It hosts joy-15. *Improve:* Prerender everything static at build. Edge-render only saved views, behind quantized pose keys, cache and a rate limit. Share the projector with sig-06.
- P 3/keep: A real molecule image in the chat is what earns the friend's click, and it arrives months before R9. It isn't play itself. *Improve:* Render the pose the sender left it at (p=) so the card feels personal.
- A 4/keep: Every link unfurls as its own molecule in ink, which gives Lupi an identity in chats. But step 0 serves the 320×200 thumbnail as og:image, which will look blurry and off-voice. *Improve:* Skip step 0, or place the thumbnail inside a designed card frame. Render cards with sig-06's CPU engine.
- Pr 5/champion: The cheapest acquisition win on the list. I verified that every /view/:slug link unfurls with the same DEFAULT_SOCIAL_IMAGE og-lupi.png (apps/mcp-worker/src/index.ts:202, 2522, 2537). Step 0, serving the existing thumbnail.dataUrl, is about 30 lines. *Improve:* Ship step 0 this week and build-time catalog cards next. Name a cost owner for resvg-wasm CPU in the Worker before uncached renders go live.
- M 4/keep: Zero-GPU cards with generated alt text work for every recipient device, including no-WebGL. *Improve:* Localise the alt-text phrase table, take colours from SM-01 tokens, and check card contrast.

<a id="r2-capture-share-loops-06"></a>
## /m/:id: a zero-canvas page for every molecule
`R2-capture-share-loops-06` · share-loop · effort M · judges mean **4.2** (E4 P3 A4 Pr5 M5; champion 1, keep 4) · self-scored fun 3 / visual 3 · perf improves

> About 100 static molecule pages (the sitemap lists 7 URLs today) that are SEO landing pages, unfurl targets and where every share lands. Each has an SVG you can spin with a finger, real facts, the observation prompt, 'Open in 3D' and 'Place on your desk', with zero canvases.

**Framing:** problem->solution

**Builds on:** C015+C016+C106, the product steward's /m spark, and the round-1 gap 'indexable zero-canvas pages'

**Problem:** `apps/web/public/sitemap.xml` lists 7 URLs. Gallery cards link to `/?sim=<id>`, the SPA root with canonical `/`, so no molecule is indexable or has its own unfurl. A stranger arriving from a share faces a splash while the ~1 MB viewer downloads. 72 deterministic SVG previews (`/learn/*.svg`), 72 observation prompts and `library-facts.json` already exist, but no page combines them.

**Solution:**

A build step in `scripts/generate-seo-routes.mjs` emits `/m/<id>/index.html` for each curated entry (72 with SVG; the snapshot-backed gallery entries follow). Each page has:
- title, description and canonical;
- og:image set to the build-time card;
- JSON-LD `MolecularEntity` (schema.org, pending section: name, molecularFormula, url, image) plus `BreadcrumbList`;
- HERO: the molecule as inline SVG, reusing C015's pocket-molecule code: math quaternions re-project up to 200 atoms into circles; still until touched; `touch-action: pan-y`; arrow keys step detents. About 3 KB gzipped of JS and no three.js;
- a FACTS block: formula, facet words and measured properties with sources, showing only reference-sheet-derived facts;
- the observation PROMPT from `STUDENT_COLLECTION`;
- VERBS:
  - 'Open in 3D', with intent prefetch after a 100 ms press or hover and Save-Data honoured. It carries the SVG's current pose as `p`, so 3D opens at the same angle (C016's match frame).
  - 'Place on your desk'.
  - 'Share', which shares the URL plus the prebuilt card PNG. The PNG is fetched at page load, so the tap is synchronous.
The sitemap is generated from the same manifest (7 URLs to about 100). Link-grammar params (`p`, `r`, `via`, `replay`, `desk`) are read client-side. Canonical stays `/m/<id>` so search consolidates, and the Worker rewrites og:image through HTMLRewriter only when params are present. Gallery cards on `/`, `/library` and `/library/gallery` link to `/m/<id>`. The Playwright zero-canvas test extends to `/m/*`.

**Experience:** Phone, from search: 'Caffeine: 3D structure, C8H10N4O2'. Thumb the SVG and it coasts on springs; read a fact; tap Open in 3D and the viewer condenses at the same pose. Desktop: hover leans the SVG toward the cursor. Keyboard: arrows turn it by detents, Enter opens 3D. Screen reader: the SVG is role=img with the generated alt and a list of its elements; the facts are real text. Reduced motion: no coast, only detent jumps.

**Tech:** `scripts/generate-seo-routes.mjs`, `library-facts.json`, `studentCollection` prompts, math quat/spring (C015). Workers static assets: 25 MiB per file, 20k files free or 100k paid (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). HTMLRewriter for param-specific meta. schema.org MolecularEntity (https://schema.org/MolecularEntity).

**Backend:** DOM/CPU (zero canvas)

**Rides (v10 requirements):** none

**v9 slice:** All of it.

**WebGL2 fallback:** Not applicable on the page. 'Open in 3D' leads to the normal viewer, including the GL2 fallback. With no WebGL at all, the page (SVG, facts, desk) is the whole experience.

**Where in code:** `scripts/generate-seo-routes.mjs`, `packages/ui/src/seo-routes.json`, `apps/web/public/sitemap.xml`, `packages/ui/src/landing/GallerySection.tsx` (the `/?sim=` links), `tools/build-student-previews.mjs`, `tests/ui/student-surface.spec.ts` (zero-canvas assertion), `apps/mcp-worker/src/index.ts` (HTMLRewriter for params).

**Risks:**

- Templated boilerplate risks thin-content penalties, so each page needs real facts and its prompt.
- The SVG spinner must stay tiny and out of the landing chunk.
- `library-facts.json` mixes Jev-judged facets with reference-derived ones. Public pages must show only derived or cited facts.
- Owner call: pages for non-student gallery entries (research trajectories) need different copy.

**Honesty:** Each SVG carries the collection's existing note ('coordinate models, not photographs; bond lines are inferred visual guides'). Facts show their sources, and Jev-inferred facets are never presented as measurements.

**Judges:**

- E 4/keep: Zero-canvas static pages that serve SEO, unfurls and share landings at once. The SVG spinner reuses the same projector and stays out of the landing chunk. *Improve:* Keep the spinner under a few KB and generate the pages from generate-seo-routes. Add a Playwright zero-canvas assert for /m.
- P 3/keep: A spinnable SVG per molecule means every share lands on something touchable, with zero canvases. Good for arrival, modest as play. *Improve:* Reuse the flagship hero's orbit kernel so the spin on /m feels identical to the home hero and the viewer.
- A 4/keep: Zero-canvas molecule pages in the ink voice, with an SVG you can spin with a finger. *Improve:* Use sig-06's named camera and ink engine, and sig-08's plates for the no-JS and error states.
- Pr 5/champion: The sitemap has 7 URLs (verified). About 100 zero-canvas /m pages at once give SEO landings, unfurl targets and share arrivals, and all of it ships on v9. Risk: library-facts.json mixes in Jev-judged values, which the contract says must not be shown as evidence. *Improve:* Show only facts that carry a source and provenance. Keep the SVG spinner out of the landing chunk. Track link_opened by kind.
- M 5/keep: Zero-canvas /m pages are the graceful floor: no WebGL needed, data-light, facts readable by screen readers, desk AR one tap away, and indexable. *Improve:* Make the SVG spinner keyboard-operable (arrows step detents), keep it still until touched, and put a size chip on 'Open in 3D' for cellular.

<a id="r2-capture-share-loops-07"></a>
## The Link Grammar: pose, look and channel in every URL, with no account and no storage
`R2-capture-share-loops-07` · foundation · effort S · judges mean **3.2** (E4 P2 A2 Pr5 M3; keep 5) · self-scored fun 2 / visual 1 · perf neutral

> One short, versioned URL grammar (`/m/caffeine?p=Q7F2K9AD&r=r1-K7QD&via=sh.story`). Any visitor can share it without signing in, the edge can draw it, the viewer opens it exactly, and it carries remix lineage and share attribution without a single stored row.

**Framing:** problem->solution

**Builds on:** C062+C107+C088 links; removes C107's storage dependency; makes the other share ideas addressable

**Problem:** Sharing a specific view requires sign-in, because the Firestore `lupiViews` create rule requires `signedIn()`. The only anonymous path is `?s=`, a base64 JSON state delta (`encodeToURL`) of up to 65,536 characters. It unfurls as the generic card and can't be decoded meaningfully at the edge. Remix results can't be shared (C062), and VIEW_FORKED is never emitted (C107). Analytics keep only the page path and first-touch UTM, so nobody can tell which format brings people back.

**Solution:**

GRAMMAR. Every part is optional and versioned, unknown params are ignored, and no free text is ever allowed.
- PATH: `/m/<catalogId>` | `/view/<slug>` | `/d/<yyyy-mm-dd>` | `/embed/...`.
- `p=`: pose code, 8 base32 characters. An octahedral-encoded view direction (2×12 bits), roll (8 bits), zoom (8 bits), a version nibble and a CRC-8. The target is always the molecule's fit centre, so poses are molecule-relative. `p=d4` is the short form for C021 detents; a teacher can hand-type `p=d1` for 'top'.
- `r=`: a remix code from C062's integer-exact codec, sampled from C048's curated look manifold.
- `f=`: trajectory frame.
- `from=`: parent remix code. A remix made after arriving by link carries its parent. That gives C107's lineage without Firestore, and family trees can be computed from logs later if ever needed.
- `via=`: channel and template (`sh.card`, `sh.story`, `qr`, `ql`, `emb`). session.ts maps it into the existing first-touch UTM context, so attribution works without UTM clutter.
- `replay=` / `chain=` (Instant Replay, Pass the Molecule) and `desk=1` (Place It on Your Desk).
Codecs live in `packages/core` with golden tests. The Worker, the viewer, `/m` pages and the MCP bridge decode them identically.
BUDGETS. At most 120 bytes without replays, which fits the 108-byte Atom QR in common cases, and at most 6 KB with chains. `?s=` stays as a legacy decode path. A local, unsaved molecule can't be linked; the sheet says so and offers a picture, a clip, or 'Save to share it live'.
ARRIVAL. `r` applies the look: a morph on v10 through the mood bus, instant on v9. The Remix button becomes primary as 'Remix this'. A remix made then emits `remix_from_link` and writes `from=`.

**Experience:** Everyone: links are short, readable and hand-editable. Phone: sharing a catalog molecule never hits a sign-in wall. Desktop: Copy link copies the grammar URL. Screen reader: the sheet's link preview reads 'Caffeine, top view, look Chalk and Ink'. There is nothing to animate, so reduced motion is unaffected.

**Tech:** `packages/core` codecs: base32, octahedral normal encoding, CRC-8; math `mulberry32` inside the C062 codec. Mapping in `packages/ui/src/analytics/session.ts` (UTM keys). Worker param parsing.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none (v9); arrival morph via the mood bus needs R3/R6

**v9 slice:** All of it; the look snaps instead of morphing on v9.

**WebGL2 fallback:** Not applicable (a codec). The mood-bus arrival morph works on both backends.

**Where in code:** New `packages/core/src/share/linkGrammar.ts`. `packages/ui/src/store.ts` (`encodeToURL`/`decodeFromURL`, `?s=`). `packages/ui/src/sceneRemix.ts`. `packages/ui/src/analytics/session.ts`. `packages/ui/src/SavedViewButton.tsx`. `apps/mcp-worker/src/index.ts`.

**Risks:**

- Saved-view cameras include target offsets, so pose codes must be computed relative to the molecule.
- Codec versions must never be reused.
- Remix decode at the edge must stay integer-only.
- `via` can be spoofed. It is attribution, not security.
- There are now two state encodings (`?s=` and the grammar) until `?s=` is retired.

**Honesty:** Links carry only catalog ids, codes and channels: no names, user text or identifiers. A remix code reproduces a look and never alters the molecule, and arrival says 'same molecule, different look'.

**Judges:**

- E 4/keep: A versioned integer codec (octahedral pose, CRC-8, remix code, via) makes every share addressable with no storage, and ships on v9. *Improve:* Golden-test the codecs in packages/core, never reuse a version, and share the header with the Replay Tape.
- P 2/keep: A necessary codec for poses and remix codes, with no play in it. *Improve:* Keep it minimal, and share it with the replay fragment format.
- A 2/keep: Outside my lens. *Improve:* p=d# detent short codes should resolve to fm-05's composed views.
- Pr 5/keep: A small, storage-free codec that makes every other share idea addressable, carries remix lineage and attribution with zero rows, and allows no free text. *Improve:* Never reuse a codec version, compute poses relative to the molecule, and test that reopening never silently changes meaning.
- M 3/keep: A short grammar with no free text is private by design; otherwise lens-neutral. *Improve:* Keep hand-typable short forms (p=d1) for teachers and assistive users.

<a id="r2-capture-share-loops-08"></a>
## Place It on Your Desk: baked AR behind every card
`R2-capture-share-loops-08` · share-loop · effort M · judges mean **4.0** (E4 P4 A4 Pr4 M4; keep 5) · self-scored fun 4 / visual 3 · perf improves

> Every catalog molecule ships a prebuilt USDZ and GLB, so a card, a poster QR or a /m page opens iPhone Quick Look or Android Scene Viewer with one real tap, at an honest, locked 1 Å = 1 cm. Sharing from inside AR sends the /m page, not a file.

**Framing:** problem->solution

**Builds on:** C110 (with C106 cards and C114 posters as entry points)

**Problem:** Quick Look is built but never triggered (`isExportingQuickLook` is only ever set back to false). When triggered, it exports on the fly and then calls `a.click()` after awaits, which risks losing the user gesture on iOS (UNVERIFIED). A blob URL can't be shared or linked. Android Scene Viewer needs a GLB hosted on https. The art director warns that Quick Look materials look plastic.

**Solution:**

BAKE. A CI job (Playwright, like `verify-asset-quality`) loads each curated molecule and runs `exportSceneBuilder` with USDZExporter, which needs a DOM canvas, and GLTFExporter, which also runs headless in Node per `verify-exports`. It uses an art-directed desk material set: PBR roughness 0.35, a soft clearcoat, the house element palette and a baked contact-shadow plane. The output is static `/ar/<id>.usdz` and `/ar/<id>.glb`, small for molecules of 200 atoms or fewer and well inside the 25 MiB per-file limit; entries over 5k atoms are skipped. These are build artifacts in the existing Workers static-asset deploy, so no R2 bucket and no new storage owner.
IPHONE. A real anchor the user taps: `<a rel="ar" href="/ar/caffeine.usdz#canonicalWebPageURL=https://lupi.live/m/caffeine?via=ql&allowsContentScaling=0&callToAction=Open%20in%20Lupi&checkoutTitle=Caffeine&checkoutSubtitle=C8H10N4O2%20%C2%B7%201%20%C3%85%20%3D%201%20cm"><img ...></a>`. Quick Look expects a single img child. `canonicalWebPageURL` makes sharing from inside Quick Look send the /m page, and `allowsContentScaling=0` locks the honest scale. A `message` listener for `_apple_ar_quicklook_button_tapped` opens the viewer at the same pose.
ANDROID. `intent://arvr.google.com/scene-viewer/1.0?file=https://lupi.live/ar/caffeine.glb&mode=ar_preferred&resizable=false&title=Caffeine&link=https://lupi.live/m/caffeine#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=https://lupi.live/m/caffeine;end;`.
DESKTOP. A large Atom QR: 'scan to place it on your desk'.
DEEP LINKS. Cards and posters link to `/m/<id>?desk=1`, where the AR button is the hero. AR cannot auto-launch, so it takes one tap. A 'Let me resize' toggle drops the lock, and the banner then says 'scale unlocked'.
SAVED VIEWS AND USER FILES. The on-device export stays but becomes prepare-then-tap: 'Prepare AR' runs the export, then the button turns into the real `rel=ar` anchor for a second tap. Hosting user USDZ is deferred until R2 has a cost owner; the proposal is the product owner, a 30-day TTL and a 10 MB cap. 'Send in 3D' shares the .usdz file itself on iOS where `navigator.canShare({files:[usdz]})` passes (UNVERIFIED), with the /m link as text.

**Experience:** iPhone: tap the card in iMessage, land on the /m page, tap 'Place on your desk'. Caffeine sits on the table about 10 cm across at true scale. Tap the banner to open Lupi at the same angle; sharing from Quick Look sends the /m link. Android: Scene Viewer shows a non-resizable model. Desktop: a QR code hands off to the phone. Keyboard: the AR link is an ordinary focusable link. Screen reader: 'Place caffeine on your desk in augmented reality, true scale, about 10 centimetres across.' Reduced motion: no motion is added; AR is user-driven.

**Tech:** three USDZExporter and GLTFExporter via `exportSceneBuilder`. Quick Look fragment parameters and banner message (https://developer.apple.com/videos/play/wwdc2020/10604/, https://www.variant3d.com/blog/using-banners-in-quicklooks). Scene Viewer intent parameters, with 10 MB recommended and 15 MB maximum (https://developers.google.com/ar/develop/scene-viewer). Workers static assets.

**Backend:** DOM/CPU (renderer-agnostic; baked in CI)

**Rides (v10 requirements):** none; R10 only for immersive WebXR, which stays frozen

**v9 slice:** All of it: the bake job, the anchors, the intents, the `desk=1` deep links and prepare-then-tap for saved views.

**WebGL2 fallback:** Not applicable. Quick Look and Scene Viewer run as OS viewers, independent of Lupi's renderer.

**Where in code:** `packages/ui/src/export/USDZExportPipeline.ts` (`USDZExportHelper`, `a.click()` after awaits), `packages/ui/src/export/exportSceneBuilder.ts`, `packages/ui/src/ViewerApp.tsx` (`isExportingQuickLook`), `tools/verify-exports.mjs` and `tools/verify-asset-quality.mjs` (the bake job), new `apps/web/public/ar/`, and the /m pages.

**Risks:**

- USDZ material fidelity in Quick Look.
- CI bake time.
- Banner-parameter behaviour can shift between iOS releases.
- Scene Viewer availability depends on the Google app or ARCore.
- True scale suits molecules, not large lattices, so those are capped.
- `canShare` for USDZ is unverified.

**Honesty:** Scale is honest by default, stated in the banner subtitle, and unlocking it is announced. AR models are illustrative meshes from coordinates, not export artifacts; USDZ is already excluded from `lupi.export_asset`.

**Judges:**

- E 4/keep: CI-baked USDZ/GLB is renderer-agnostic and extends the C110 champion to every card. Note that three's USDZ bytes are not stable across runs (AGENTS.md: process-global object ids), so every bake churns the files. *Improve:* Publish the bakes as build or R2 artifacts keyed by input hash, not committed files. Cap atom counts for Quick Look.
- P 4/keep: 'Put caffeine on my desk' is a genuine wow on an iPhone and a classic show-a-friend moment, and baking every molecule removes the wait. *Improve:* Offer the desk button right after a satisfying moment, such as a detent landing. Add a 'bigger' option, since 1 Å = 1 cm makes water tiny.
- A 4/keep: An art-directed desk material (roughness 0.35, soft clearcoat, house palette, baked contact shadow) answers round 1's AR conditions. *Improve:* Take the palette from sig-01. Verify that Quick Look renders the clearcoat, and keep the honest 1 Å = 1 cm scale.
- Pr 4/keep: iPhone Quick Look is built but unwired: setIsExportingQuickLook is only ever called with false (verified). Baked AR at an honest, locked 1 Å = 1 cm, plus Android Scene Viewer, extends the champion C110 to every card and poster. *Improve:* Wire the iPhone button first, then add the CI bake with size caps.
- M 4/keep: OS viewers (Quick Look, Scene Viewer) are accessible and independent of Lupi's renderer, so old iPhones on GL2 still get AR. *Improve:* Show a size chip on cellular, announce the honest scale ('1 Å = 1 cm'), and give a text alternative for the desk prompt.

<a id="r2-capture-share-loops-09"></a>
## The Specimen Camera develops the card
`R2-capture-share-loops-09` · flagship · effort M · judges mean **3.6** (E4 P3 A5 Pr3 M3; champion 1, keep 4) · self-scored fun 4 / visual 5 · perf costs

> A shutter on the canvas freezes the pose and quietly develops a clean frame offscreen while you keep playing: supersampled on v9, accumulated and focused on v10. The developed print becomes your share card, your saved view's unfurl, your sticker and your embed poster.

**Framing:** problem->solution

**Builds on:** C060+C061 (tier 1 only), C009 (focus patch), C002 (sleep), C041 (click), C105/C106 (outputs)

**Problem:** Cards and stickers captured from the live frame look like screenshots: aliased impostor edges, and no AO or depth of field on phones. C060 was L-scoped. C061's idle refinement must be bounded (mobile judge). The art director wants the shutter to visibly develop the card. Saved-view thumbnails are 320×200 and die with `preserveDrawingBuffer` in v10.

**Solution:**

SHUTTER. A DOM button in the thumb zone. Because it is a direct DOM tap, it is the one place an iOS haptic tick is allowed (the switch pattern; UNVERIFIED per the fact sheet), and it plays C041's click. Pressing it snapshots the Shot (pose, look, frame) and develops offscreen at Card size (1200×630). The live view stays fully interactive, because development uses its own camera and target.
ON v9: one 2× supersampled render (2400×1260), box-filtered down in the capture worker. Zero GLSL.
ON v10:
- Halton-jittered accumulation, sub-pixel `setViewOffset` into a HalfFloat target.
- N = 32 samples on desktop, 16 on phones, 8 in Low Power Mode.
- The pipeline's full-resolution AO, and `dof()` focused on the atom you tapped before shooting. Tap-to-focus reads a finger-sized ID/depth patch (C009).
- It runs as a scheduler job with an `fps` cap. It advances while you are idle, pauses while you interact (never competing with input), then sleeps (C002).
THE SHEET shows the print developing from real progressive readbacks every four samples at preview size, not a fake animation. On v9, a short CSS fade marked as UI stands in.
WHERE THE PRINT GOES:
1. The Card, Square, Sticker and Wallpaper templates.
2. On Save, a 600×315 JPEG of at most 60 KB replaces the 320×200 `thumbnail` in the existing Firestore field. No new storage; the cost owner is the existing `lupiViews` budget. It becomes the unfurl via Unfurl Everything step 0.
3. The poster for tap-to-wake embeds.

**Experience:** Phone: tap an atom (a focus ring appears), tap the shutter (a tick), keep flicking. A print tile in the corner develops; tap it to open the sheet. Desktop: click the shutter or press S. Keyboard: F focuses the selected atom (D2's atom cursor) and S shoots. Screen reader: 'Photo taken of caffeine, focused on oxygen 1, developing, 50 percent… ready.' Reduced motion: no developing animation; the print appears when done.

**Tech:** The capture service. v10: a HalfFloat RenderTarget accumulated with a TSL blend in a fullscreen pass, `dof()`, `ssao()`/`ao()`, `setViewOffset` jitter, scheduler job `fps` and `onIdle` (@pmndrs/scheduler 0.2.0). v9: a 2× WebGLRenderTarget with a worker box filter. math `spring` for the focus ring.

**Backend:** v9 WebGL (supersampled raw); v10 [GPU+GL2] (accumulation, AO, DOF)

**Rides (v10 requirements):** R6 (pipeline AO/DOF), R7 (bounded job), R9 (readback), C009 (focus patch)

**v9 slice:** The shutter button and click, a 2× supersampled print, and the saved-view card upgraded to 600×315 inside the existing 60 KB field.

**WebGL2 fallback:** Accumulation is a render-to-texture blend with no compute, so it works on the GL2 backend. DOF and AO run at whatever rung the device allows. Old iPhones use 8 samples at Card size.

**Where in code:** New `packages/ui/src/capture/develop.ts`. `packages/ui/src/viewer/captureViewerThumbnail.ts` (replaced). `packages/ui/src/savedViews.ts` (`SavedViewThumbnail`, `THUMBNAIL_WIDTH/HEIGHT`, `MAX_DATA_URL_LENGTH` 60_000). `packages/ui/src/SavedViewButton.tsx`.

**Risks:**

- HalfFloat bandwidth on tile GPUs.
- DOF quality and cost on phones are unmeasured.
- The 60 KB cap may force JPEG quality near 0.6 at 600×315.
- A Firestore doc holding 5k-atom inline XYZ plus the card must stay under 1 MB.
- The iOS haptic claim needs a device test.

**Honesty:** A print shows the same molecule and pose, only cleaner. DOF is named as a photographic effect in the card footer ('focus: O1'), never data. Accumulation is bounded, runs only after an explicit shutter press, and then sleeps.

**Judges:**

- E 4/keep: The v9 2× supersample needs zero GLSL. The v10 Halton accumulation is a bounded job that ends in sleep and runs on GL2, because it is plain render-to-texture. HalfFloat accumulation is expensive on tile GPUs. It hosts pocket-09's landscape viewfinder. *Improve:* Use fewer frames or UnsignedByte accumulation on phones. Keep DOF optional until C014 data exists.
- P 3/keep: A shutter that develops while you keep playing is nice, but photo mode is a niche pleasure for a stranger. *Improve:* Make Sideways Is a Camera its discoverable entry, and keep this as the develop pipeline.
- A 5/champion: The best frame the product can make, at no interactive cost: accumulation, full-resolution AO, tap-to-focus, and a 'developing' preview built from real progressive readbacks. *Improve:* Make DOF opt-in and gentle, so the focused neighbourhood stays sharp and the specimen never turns to mush. Absorb pk-09's viewfinder and cross-06's long exposure as shutter modes, and tune against sig-12's references.
- Pr 3/keep: The v9 shutter, one 2x supersampled render, is cheap quality for cards. The v10 accumulation and DOF cost is unmeasured on phones. It hosts pocket-09. *Improve:* Make it the 'still' driver of the Shot service rather than a separate pipeline.
- M 3/keep: The v9 2× supersample (2400×1260) and HalfFloat accumulation cost memory and bandwidth on phones ('perf costs'), and DOF cost on phones is unmeasured. *Improve:* The phone rung is a 1× render with light accumulation only at rest. Skip accumulation in LPM and register the target in P-11's ledger.

<a id="r2-capture-share-loops-10"></a>
## The Daily, shared without spoilers
`R2-capture-share-loops-10` · share-loop · effort S · judges mean **3.8** (E3 P4 A4 Pr4 M4; keep 5) · self-scored fun 4 / visual 4 · perf improves

> Lupi Daily's share is a spoiler-free ink-silhouette card with a text result line, served from date-keyed URLs that never name the answer. Tomorrow, yesterday's bloom (silhouette to colour, on tap) is the reason to come back.

**Framing:** problem->solution

**Builds on:** C088+C103+C106 (the brief's combo), C090 (shadow match), C049 (print voice)

**Problem:** C088 is the only come-back-tomorrow loop, but a result share showing colour, name or formula spoils it for friends. Screen-reader players need a text result (mobile judge). The art director wants the Daily in the Illustrate voice. It must ship on v9 as DOM with zero canvases on `/`, and home motion must start only on touch.

**Solution:**

URLS THAT NEVER NAME THE ANSWER:
- The page is `/d/2026-10-01`.
- The card is `/og/d/2026-10-01.png`, a static file prebuilt for the curated 60-day queue. It uses the SVG projection with every fill set to ink #06080d on paper, at the day's pose.
- No id appears in filenames, meta or JSON-LD.
RESULT SHARE. Text first: 'Lupi Daily 2026-10-01 · solved on clue 3 of 6 · no hints' plus the link. A glyph row is optional decoration, never the only carrier.
AFTER SOLVING. An optional 3 s ink-spin clip (a turntable of the silhouette, one ink colour) as a 'beat my clue count' dare. It shows shape only, never colour, name or formula.
TOMORROW. The home Daily card shows 'Yesterday: caffeine' with a still poster. A tap plays a 3 s bloom `<video>` (ink to element colour), prebuilt in CI by the capture service in headless Chromium and served as a static MP4 of about 300 KB. Zero canvases on `/`, and motion only on tap.
ARRIVAL:
- `/d/<today>` opens today's puzzle, unrevealed.
- `/d/<past>` says 'This was the Oct 1 puzzle', links the answer to `/m/caffeine`, and offers today's.
- Puzzles roll over at local midnight on the client. Edge cards never reveal, whatever the date.

**Experience:** Phone: solve over breakfast, tap Share, and the sheet shows the ink card and the text result. The friend taps the link and plays today's. Next morning the home card shows yesterday's answer, which blooms on tap. Desktop: identical. Keyboard: the whole Daily runs on keys, with C088's ladder of text clues. Screen reader: the result is plain text; the silhouette's alt is 'Today's mystery molecule, silhouette', never the answer. Reduced motion: the bloom is a crossfade between two stills.

**Tech:** The `build-student-previews` SVG projection (ink variant). resvg at build. The capture service in headless Chromium in CI for bloom videos (the WebGL/SwiftShader lane already used by the verifiers). A date-seeded queue order via mulberry32 over a steward-curated list.

**Backend:** DOM/CPU (v9); in-app clips via the capture service (raw on v9, Illustrate on v10)

**Rides (v10 requirements):** none (v9); R3/R6 for the in-app Illustrate ink loop (C049)

**v9 slice:** `/d` pages, ink cards, text results, CI-prebuilt bloom videos in the raw look, and the home card with tap-to-play.

**WebGL2 fallback:** Cards and videos are static. In-app clips follow the capture service's rungs, including GIF.

**Where in code:** `tools/build-student-previews.mjs` (ink variant), `scripts/generate-seo-routes.mjs` (`/d` pages, noindex), `packages/ui/src/landing/*` (Daily card; zero-canvas test in `tests/ui/student-surface.spec.ts`), the C088 module, and a CI workflow step for bloom videos.

**Risks:**

- The queue ships in the JS bundle, so a determined reader can spoil it, as with Wordle; that is acceptable if ids stay out of URLs and meta.
- CI renders run on SwiftShader, so bloom quality is the raw look until the Illustrate renders exist.
- The 60-day curation needs a content-steward owner.
- An ink spin may be judged too big a hint, so it is offered only after solving.

**Honesty:** Bloom videos say 'coordinate model · illustrative rendering'. Results never contain the answer. Streaks stay in localStorage with no shaming (D7 rule).

**Judges:**

- E 3/keep: Static, text-first spoiler-free cards cost almost nothing. CI-prebuilt SwiftShader videos will look second-rate. *Improve:* Prebuild ink cards from the CPU Illustrate engine (sig-06), and render bloom clips with capture-01 once R9 exists.
- P 4/keep: The Wordle loop done right: a spoiler-free text result, an ink silhouette, and yesterday's bloom as the reason to come back. *Improve:* Make the solve moment itself juicy (condense into colour, a chord), and add a tiny symmetry glyph to the result line.
- A 4/keep: Ink silhouettes that never name the answer are a clean visual device, and blooming from silhouette to colour is a good reveal. *Improve:* Render with sig-06's ink engine, and make the bloom the same Ink-to-Light transition rather than a new one.
- Pr 4/keep: A text-first result share, as Wordle proved, from date-keyed URLs that never name the answer. It gives C088 a return reason with no streaks. It hosts joy-14 and real-twins-15 as rotating formats. *Improve:* Put a named steward on the 60-day queue, and exclude psychoactive entries.
- M 4/keep: A text-first result line whose glyph row is never the only carrier is an accessible share done right, and cards are static. *Improve:* Make the bloom clip tap-to-play (never autoplay), and give the silhouette card alt text that doesn't spoil the answer.

<a id="r2-capture-share-loops-11"></a>
## Tap-to-Wake Embeds that sleep by reloading
`R2-capture-share-loops-11` · share-loop · effort M · judges mean **3.4** (E3 P3 A3 Pr4 M4; keep 5) · self-scored fun 3 / visual 3 · perf improves

> A copy-paste iframe with oEmbed that is just a card image and a play button until a reader taps. It then condenses into live 3D at the card's exact pose, and goes back to sleep by reloading itself as a poster of wherever the reader left it, so host pages never pay GPU memory for an idle embed.

**Framing:** problem->solution

**Builds on:** C109 (plus C106 poster, C030 wake, C016 match frame); the engineer's mount-on-tap, unmount-on-scroll-out

**Problem:** Blogs and LMSs are acquisition channels (the Sketchfab and 3Dmol precedent), but a live canvas per embed costs page weight and battery. The v10 renderer leaks on unmount (#3926, fixed only in a PR). The art director warns that the poster-to-live swap can pop. Today the only embedded route is the Expo shell's `#/embed/mobile`.

**Solution:**

ROUTES on the Worker: `/embed/m/<id>` and `/embed/view/<slug>`, with link-grammar params. Each returns about 2 KB of HTML: a `<button>` wrapping the edge card `<img>` (Square or 16:9), a play glyph and the 'Illustrative 3D · Lupi' mark. `/oembed?url=` returns `{type:'rich', version:'1.0', html:'<iframe ... loading="lazy" title=...>', width, height, thumbnail_url, provider_name:'Lupi'}`. /m and /view pages carry `<link rel="alternate" type="application/json+oembed">`.
WAKE, on tap or Enter. The viewer mounts in embed mode: demand frameloop, minimal chrome, no panels. Its first frame is at the card's pose; the shared `packages/core` projection makes the match frame. It condenses from the poster (C030; the v9 `uProgress` slice) and crossfades the poster out.
SLEEP. An IntersectionObserver uses the implicit root, the top-level viewport. After 20 s fully out of view or 90 s idle, the capture service makes a Square poster at the current pose. The iframe then calls `location.replace()` on its own poster URL with the new `p=`. Document teardown frees the GPU regardless of #3926, and nothing is stored.
OPEN. An 'Open in Lupi' chip opens `/m/<id>?p=..&via=emb` in a new tab.

**Experience:** Phone reader on a chemistry blog: a crisp card. Tap it and the molecule condenses and spins under the thumb. Scroll away and back: it's asleep at the angle you left it. Desktop: the same with a mouse. Keyboard: Tab to the poster, Enter wakes, Esc sleeps. Screen reader: 'Load interactive 3D model of caffeine (C8H10N4O2)'. Reduced motion: a crossfade instead of the condense, and nothing ever autoplays.

**Tech:** Worker routes plus the oEmbed spec (https://oembed.com/). IntersectionObserver in cross-origin iframes. Scheduler demand frameloop. Capture-service poster. HTMLRewriter.

**Backend:** DOM/CPU until tap; viewer [GPU+GL2] after

**Rides (v10 requirements):** R7 (demand default), R9 (poster capture), C030; #3926 sidestepped by reload

**v9 slice:** Poster plus oEmbed, wake into the v9 viewer (`uProgress` condense), and sleep-by-reload with a poster from the v9 capture adapter.

**WebGL2 fallback:** Wakes on the GL2 backend identically. With no WebGL, the poster stays, with 'Open in Lupi'.

**Where in code:** `apps/mcp-worker/src/index.ts` (new `/embed/*` and `/oembed`), `apps/web/src/main.tsx` (embed mount mode next to `mountViewer`), `packages/ui/src/viewer/viewerRoutes.ts` (next to `isEmbeddedMobileViewerRoute`), and the capture service.

**Risks:**

- WebGPU inside cross-origin iframes varies by browser and permissions policy (verify; GL2 fallback).
- Host CSPs may block the iframe.
- CMS oEmbed discovery is uneven.
- The reload can flash, which a matched poster and a crossfade before `replace()` mitigate.

**Honesty:** The poster says it is illustrative. The embed shows exactly the linked molecule and look. Host pages are counted only coarsely (poster fetches by kind), never by referrer URL.

**Judges:**

- E 3/keep: Sleeping by reloading is a clever way around the #3926 renderer leak, and a poster-only embed costs hosts nothing. WebGPU inside cross-origin iframes is unverified, and the reload can flash. *Improve:* Verify iframe WebGPU and fall back to GL2. Take the poster from capture-01 so the reload crossfades onto an identical frame.
- P 3/keep: Tap-to-wake is how a blog reader becomes a player, and sleeping by reload is a pragmatic fix. More distribution than play. *Improve:* Wake straight into the flagship's flick, with the Verb Ladder hint.
- A 3/keep: Sleeping by reloading risks a visible flash at each wake and sleep. *Improve:* Crossfade poster to canvas at the exact pose (sig-06), with the pipeline prewarmed (port-06).
- Pr 4/keep: Acquisition through teachers and bloggers via oEmbed. Sleeping by reloading sidesteps the renderer leak (#3926). Browsers differ on WebGPU inside cross-origin iframes. *Improve:* Sequence it after /m pages, and verify the GL2 fallback inside iframes.
- M 4/keep: Nothing autoplays, sleep-by-reload frees GPU memory on host pages, and reduced motion gets a crossfade. iOS throttles iframe rAF until a tap anyway. *Improve:* Give the poster button an accessible name, crossfade before replace() to avoid a flash, and keep a no-WebGL 'Open in Lupi' link.

<a id="r2-capture-share-loops-12"></a>
## Atom QR: every printed or posted image finds its way home
`R2-capture-share-loops-12` · share-loop · effort S · judges mean **2.8** (E3 P2 A3 Pr3 M3; keep 4, park 1) · self-scored fun 3 / visual 3 · perf neutral

> Story end frames, posters, printed cards and the desktop 'place on your desk' prompt carry a scannable QR code drawn as atoms in house ink. It encodes the short link, so a picture on a classroom wall or a reposted story leads back to the live molecule.

**Framing:** capability->problem

**Builds on:** new; complements C114 (posters) and C110 (desk); reuses the repo's atom-QR generator

**Problem:** Images leave Lupi and never come back: a poster on a wall, a screenshot, a story repost carry no link. Round 1's poster studio (C114) had no return path. The desktop AR prompt needs a handoff to the phone. The repo already has a dependency-free atom-QR generator (`scripts/generate_social_qr_atoms.py`, byte mode, ECC-M, up to 108 bytes, dark modules as carbon atoms), and nothing reuses it.

**Solution:**

Port the generator to `packages/core/src/share/atomQr.ts` and render it as a 2D mark inside templates, not as a 3D render:
- the three finder patterns stay solid ink squares, for scan reliability;
- data modules are ink dots at 82% of module size with a faint highlight;
- the quiet zone is 4 modules;
- minimum size is 22 mm in print and 180 px on screens.
The payload is the link-grammar URL with `via=qr` (for example `lupi.live/m/caffeine?r=r1-K7QD&via=qr`, about 45 bytes).
Placement: the Story end frame (bottom right, inside app-chrome safe margins), the poster footer, and the desktop AR prompt (large). Cards and stickers get none, because unfurls are already links.
CI golden test: decode every template's QR with a JS decoder (jsQR or zxing-wasm) at three scales plus blur.
Easter egg: the existing Social QR molecules (`social-qr/*.xyz`) stay a hidden find in the viewer, and scanning the screen from another phone opens Lupi.

**Experience:** A teacher prints the A4 poster; students scan it with phone cameras and land on /m/caffeine, then place it on their desks. A desktop visitor clicks 'Place on your desk', gets a big atom QR, scans it and is in Quick Look. A story repost still leads home. Screen reader: the QR's alt is 'QR code linking to lupi.live/m/caffeine', and the URL is printed beside it in type. Keyboard: not applicable (a static mark).

**Tech:** A QR encoder ported from `scripts/generate_social_qr_atoms.py`. 2D compositing in the capture worker. jsQR or zxing-wasm in CI. The link grammar.

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it.

**WebGL2 fallback:** Not applicable (a 2D mark).

**Where in code:** `scripts/generate_social_qr_atoms.py` becomes `packages/core/src/share/atomQr.ts`. `packages/ui/src/capture/templates/*`. `apps/web/public/social-qr/` (existing). New decode tests.

**Risks:**

- Dot-style QR codes scan less reliably when small or low-contrast. Mitigations: square finders, ECC-M or Q, size floors and CI decoding.
- App UI chrome can crop story corners, so the code sits inside safe margins.
- Long `replay` links exceed 108 bytes, so a QR never carries a replay.

**Honesty:** It is styled as dots but always presented as a code, with the URL in type beside it, never as a structure. The existing Social QR README already labels these as QR codes.

**Judges:**

- E 3/keep: A small 2D mark with CI decode tests, and a sensible loop back from print. Dot-style QR codes are fragile when small. *Improve:* Enforce the size floors and solid finders in the template, and decode every template in CI.
- P 2/park: Cute (a QR code drawn as atoms), but a small reach channel with no play. *Improve:* Revisit once posters and printed cards exist.
- A 3/keep: A QR code drawn as atoms in house ink is a nice brand detail, but it can tip into twee, and scan reliability comes first. *Improve:* Use it only on end frames and posters, never over the molecule.
- Pr 3/keep: A cheap channel from classroom posters and prints back to the live molecule, reusing the repo's existing QR script. Dot-style QR codes are less reliable to scan. *Improve:* Add a CI decode check, and enforce minimum sizes.
- M 3/keep: Printed QR codes lead home, but dot-style codes scan less reliably when small or low-contrast. *Improve:* Always print the short URL as text beside the code, and enforce contrast and size floors in CI decoding.

<a id="r2-capture-share-loops-13"></a>
## The Receiving End: arrive inside the moment
`R2-capture-share-loops-13` · flagship · effort M · judges mean **3.8** (E3 P4 A4 Pr4 M4; keep 4, merge 1) · self-scored fun 4 / visual 4 · perf improves

> Every share lands the recipient in a designed first five seconds that matches what they tapped in the chat. The unfurl image becomes the page, the page becomes the 3D view at the same pose, and one obvious next verb (watch, play today's, place it, remix this, your turn) closes the loop.

**Framing:** problem->solution

**Builds on:** C016, C030, C019 (reworked), C088, plus Instant Replay, Pass the Molecule, /m pages, the desk links and embeds; D1's first minute, seen from the share side

**Problem:** Round 1 designed the sending side. The receiving side today is a UA-sniffing redirect script to `/#/view/<slug>`, followed by a splash while about 1 MB of viewer loads. The retention audit's E001 bug once locked a 404 view in a permanent spinner. Recipients decide in seconds, and nothing they see matches the image they tapped.

**Solution:**

ARRIVAL TABLE by link kind (link grammar):
- CARD LINK (`/m/<id>?p&r`): the /m page renders the SVG at pose p in look r's palette, using the same projection as the card. The image they tapped is the page they see. The viewer is prefetched on a 100 ms intent. Primary verb 'Open in 3D' condenses at the same pose (C016/C030). Secondary: 'Remix this' when r is present, and 'Place on your desk'.
- REPLAY: the poster is the clip's hero frame. Primary verb 'Watch it happen' plays the replay live in 3D. Then 'Your turn', with a single coach mark (C019 reworked as an abstract touch mark) showing the gesture the sender used: 'they flicked; try it'.
- CHAIN: 'Turn 3 of 4: watch, then add yours'.
- DAILY: today's puzzle, never the answer. A past date gets the answer plus today's.
- DESK (`desk=1`): the AR button is the hero.
- EMBED 'Open': the full viewer at the embed's pose.
RULES:
- One primary verb per arrival.
- No sign-in wall before play.
- The look morphs in only if r differs from the default (the mood bus on v10, instant on v9).
- The camera never moves without input: replays start on tap and never autoplay.
- Arrival is the first-touch attribution moment (`link_opened` with kind and via).
FAILURE DESIGN. A missing or private view gets a real card, 'This view isn't available. Here is caffeine instead', never a spinner. That closes the E001 class of bug.

**Experience:** Phone: tap the card in iMessage and the page shows exactly that image with one big button. 3D condenses in at the same angle. 'Remix this' gives you your own look and your own link. Desktop: identical, and hover prefetches. Keyboard: the primary verb takes first focus. Screen reader: arrival announces 'Shared view of caffeine, top view. Open in 3D.' Reduced motion: crossfades replace condensing, and replays become storyboards of stills.

**Tech:** The link grammar. A shared projection in `packages/core` (SVG, edge card and viewer). Intent prefetch via modulepreload. View Transitions with a FLIP fallback. Capture-service posters.

**Backend:** DOM/CPU, then viewer [GPU+GL2]

**Rides (v10 requirements):** none on v9 (the `uProgress` condense slice); R3 for the full condense

**v9 slice:** /m arrival pages, intent prefetch, the v9 `uProgress` condense, tap-to-play camera replays and the failure card.

**WebGL2 fallback:** The same flow. GL2 devices get the same arrival. With no WebGL, the /m page (SVG spinner, facts, desk) is the complete experience.

**Where in code:** `apps/mcp-worker/src/index.ts` (`renderSavedViewShareHtml`: its redirect script becomes an arrival page). `apps/web/src/main.tsx` (`mountViewer`, `Splash`). `packages/ui/src/savedViews.ts` (404 path). The /m pages. `packages/ui/src/viewer/viewerRoutes.ts`.

**Risks:**

- The SVG-to-impostor match is approximate; radii and perspective must share code.
- UA-based bot detection is fragile, so arrival pages must work for bots and humans alike.
- Seams overlap with D1's first-minute flagship and need coordinating.
- Too many arrival variants can dilute the design.

**Honesty:** Replays are labelled 'Shared replay'. A remix arrival says 'same molecule, different look'. Nothing moves on arrival without a tap, and failures say plainly what is missing.

**Judges:**

- E 3/merge: Merge into R2-first-minute-flagship-03. The per-link arrival table is useful, but it overlaps the relay, the Arrival Router and /m. The SVG-to-impostor match is approximate. *Improve:* Encode the arrival table as a routing map inside the relay stage, reusing port-02's FROM fields.
- P 4/keep: The friend's first five seconds decide whether the loop spreads, and landing inside the moment with one obvious next verb is strong. It overlaps the flagship's relay. *Improve:* Share the relay stage and match frame with the flagship, so arriving from a link and arriving from / feel identical.
- A 4/keep: 'The image you tapped is the page you see' gives recipients visual continuity. *Improve:* Fold it into one arrival spec with fm-01, fm-03 and sig-06.
- Pr 4/keep: Referred visitors convert, or don't, on arrival, and an arrival table by link kind is the right spec. It overlaps flagship-03 and flagship-14. *Improve:* Keep it as the one arrival spec, and have the D1 components implement it.
- M 4/keep: It states the comfort rule outright: replays start on tap and never autoplay. There are crossfades under reduced motion, and the /m page is the complete experience without WebGL. *Improve:* Bind it to FM-01's seams as the recipient's first minute, announce the one primary verb, and point FM-10 at this spec.

<a id="r2-capture-share-loops-14"></a>
## The Loop Ledger: share metrics that count spread, not button presses
`R2-capture-share-loops-14` · system · effort S · judges mean **3.2** (E4 P2 A2 Pr5 M3; keep 2, merge 3) · self-scored fun 1 / visual 1 · perf neutral

> A small set of PII-free events plus edge counters measures the whole loop per template and channel: prepared, handed to an app, unfurled in a chat, opened, remixed, turn taken. It replaces today's `view_shared`, which fires on every save.

**Framing:** problem->solution

**Builds on:** the round-1 gap 'PII-free delight events', the product steward's share metrics, C107 (VIEW_FORKED)

**Problem:** `SavedViewButton.tsx` fires `VIEW_SHARED` with `method:'auto_copy'` on every save and before `navigator.share` resolves. It therefore counts intents, not shares, and cannot tell a completed share from a cancelled one. The edge allowlist (`ANALYTICS_EVENTS` in `apps/mcp-worker/src/index.ts`) has drifted from the client: `library_searched` is emitted client-side but missing from the Worker set, so it is silently dropped. The analytics payload keeps only the path and first-touch UTM, so nobody knows which format brings people back. `tools/analytics-report.mjs` FUNNEL has no share stages.

**Solution:**

CLIENT EVENTS (props are enums and counts only):
- `share_prepared {template, format: png|mp4|gif|pdf|usdz, backend: v9|gpu|gl2, msBucket}`
- `share_completed {template, method: sheet|clipboard|download|link, result: handed|copied|saved|cancelled|failed}`. The sheet result comes from the `navigator.share` promise: resolve means handed to an app; AbortError means cancelled.
- `link_opened {kind: m|view|daily|replay|chain|embed|desk, via, hasRemix}`, once per session at arrival.
- `remix_from_link {kind}`, `replay_watched {completed}`, `turn_taken {turn}`, `desk_opened {platform}`, `embed_woken`, `daily_result_shared`.
EDGE, with no client code: `unfurl_fetched {kind, family: slack|discord|imessage|x|whatsapp|other}` is logged when a known preview bot fetches /m, /view, /d or /card. It is a proxy for 'this link landed in a chat', and it counts copy-pasted URL-bar links too. No IPs, no referrers, no slugs; saved-view slugs are user text and are dropped.
RATIOS, aggregated by day × template or channel, with no per-share ids:
- completion = handed / prepared
- landing = unfurl_fetched / handed
- open = link_opened / handed
- remix-from-link = remix_from_link / link_opened
- relay = turn_taken / replay_watched
- Daily return = Daily plays from a link / Daily links opened
Baselines are gathered for two weeks before anyone sets a target.
HYGIENE:
- One `ANALYTICS_EVENTS` source in `packages/core`, imported by both client and Worker, or a CI parity test. This fixes the drift.
- `view_shared` is redefined to fire only on `share_completed`.
- `analytics-report.mjs` gains the share stages.
- A documented cap on how many delight events exist.

**Experience:** Invisible to visitors. The owner gets a weekly 'which format spreads' table. No new consent surface: collection stays first-party and PII-stripped, as today, with no identifiers.

**Tech:** `packages/ui/src/analytics` (`track.ts` PII filter, `session.ts` UTM mapping `via`), the Worker's `sanitizeAnalyticsEvent`/`ANALYTICS_EVENTS`, the Workers logs sink (`console.log` with `component: 'lupi_analytics'`), `tools/analytics-report.mjs`

**Backend:** DOM/CPU

**Rides (v10 requirements):** none

**v9 slice:** All of it; it should land first, so every other share idea ships measured.

**WebGL2 fallback:** Not applicable. `share_prepared.backend` records GL2 so fallback users are visible.

**Where in code:** `packages/ui/src/analytics/events.ts`, `track.ts`, `session.ts`. `packages/ui/src/SavedViewButton.tsx` (the VIEW_SHARED calls). `apps/mcp-worker/src/index.ts` (`ANALYTICS_EVENTS`, `collectAnalytics`, the bot regex in `renderSavedViewShareHtml`). `tools/analytics-report.mjs`.

**Risks:**

- `navigator.share` resolves when the share is handed to a target, not when the message is sent.
- Preview-bot user agents are heuristic; iMessage previews use a facebookexternalhit-like UA.
- `link_opened` needs first-touch-per-session logic.
- Two analytics sinks (Cloud Logging in `functions/` and Worker logs) must be reconciled.

**Honesty:** Every metric is a labelled proxy. No number becomes a target before baselines exist, and nothing is tied to a person or a device identifier.

**Judges:**

- E 4/merge: Merge into R2-first-minute-flagship-12. Replacing view_shared, which fires on every save, with enum-only share events plus edge unfurl counters is right. It should be one taxonomy PR, not two. *Improve:* Land it in the same events.ts section with the same PII key-pinning tests.
- P 2/merge: Counting spread rather than button presses is right, but it's analytics. Host: R2-first-minute-flagship-12. *Improve:* Fold it into one event taxonomy with the first-minute telemetry.
- A 2/keep: Outside my lens. *Improve:* Record the template and Look as props, so art direction can see which designs spread.
- Pr 5/merge: Merge into R2-first-minute-flagship-12. It counts spread, not button presses, and correctly retires view_shared, which fires on the auto-copy after every save (SavedViewButton.tsx:251, verified). *Improve:* Make it one taxonomy with the first-minute events.
- M 3/keep: Recording the backend makes the GL2 share funnel visible; otherwise lens-neutral. *Improve:* Share one taxonomy with FM-12 and add the comfort and input-modality enums.
