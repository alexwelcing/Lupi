# Wave 3: Instant Replay on The Shot, status

Short-list item 9: [Instant Replay](round2/capture-share-loops.md#r2-capture-share-loops-03) on [The Shot](round2/capture-share-loops.md#r2-capture-share-loops-01), with round 1's [C103](round1-catalog.md#c103). Built on `w4/share` from `df1aa66` under the owner's rule: build, then the owner validates. The only checks were the TypeScript builds of `@atlas/scene`, `@atlas/ui` and `@atlas/mcp-worker`, lint, and those packages' existing unit tests. **Nothing here has been seen running in a browser.**

## What shipped for a visitor

### Sending: "Replay ↗" on the pill

- **The viewer keeps the last 20 s in memory.** It records the camera pose of every drawn frame that moved, plus the toy inputs and the pill's flashes. Nothing leaves the page until you tap.
- **Moments.** The pill offers **Replay ↗** for 7 s after:
  - a good flick: a coast that turned more than about 216°, or one that clicked into a named face after a quarter turn;
  - a chain of three named faces in a row, from flicks or arrow keys;
  - Spin's tennis-racket flip, or a flip a flick found on its own;
  - a toy moment: a burst, a tug that was pulled, about a second of heat, a scatter, a good stir, or five atom taps in a row.
- **The offer sits in the same pill.** It is one more segment before stow, so there is no new chrome on phones. It eases in and does not bounce. **R**, the Play tray's **Replay ↗** (last row, beside Settings…) and the palette's "Replay the last moment" open the same thing at any time. With no moment yet, R shares the current view as a still link.
- **One tap opens the sheet.** It holds two things:
  - **The live link**, ready at once, with Copy and Share. It carries `replay=` with the moment's tape, typically 0.5 to 1.5 KB, and nothing is stored anywhere. The sheet shows the byte count.
  - **A 9:16 clip**, developing right away in the sheet's preview. It is 720×1280 on phones and 1080×1920 on desktop. Since Sprint S2 it is rendered frame by frame from the tape into an MP4 wherever WebCodecs can encode it (see [Frame-exact clips](#frame-exact-clips-sprint-s2)); elsewhere it is the normal video export, replaying the moment off screen with the toys allowed, MP4 where the browser records MP4 (Safari) and WebM elsewhere. Every frame carries the molecule's name, "Illustrative motion · lupi.live" and the pill's flash as it played (for example "Pentagon face-on · 5-fold axis"). It ends on a sage card reading "Your turn" with the molecule's `/m` page.
  - When the clip is ready, **Share clip + link** sends both together where the share sheet takes files, and **Save clip** downloads it. Closing the sheet cancels a clip that is still recording.
- **Motion: Still.** The offer reads **Share ↗**. The link opens on the moment's last pose and nothing plays, and there is no clip.
- **A molecule with no address** (a dropped file or a generated lattice) gets the clip only, and the sheet says why.

### Receiving: a `?replay=` link

- **Opening.** The molecule opens at the moment's first pose. The pill reads **Shared replay**, with **▶ Watch** beside it.
- **Starting.**
  - Standard plays it on its own about 0.7 s after the molecule lands and its arrival ends.
  - Gentle waits for ▶ Watch.
  - Still opens on the last pose, plays nothing, and says "Shared view · your turn".
- **Playing.** The moment plays in the visitor's own 3D view:
  - the camera follows the sender's path, reframed so the molecule fits a narrower or wider screen;
  - the toys replay through the visitor's own Play layer, at the visitor's Motion comfort;
  - the face names flash on the pill as they did for the sender.
- **Taking over.** Any touch, wheel or key takes over at once, from wherever the camera is. **Skip** jumps to the end.
- **Your turn.** The pill then says **Your turn** with the sender's gesture, for example "Your turn · flick it", "flick it into a face" or "Play › Spin". A toy moment also latches that toy, so "Your turn · tap to pop" means the next tap pops. **↺ Again** stays on the pill for 9 s.
- **Clean address bar.** The viewer removes `replay=` from the address bar as it reads it, so a reload or a later share does not replay it again.
- **Unreadable links.** A link this build cannot read says so on the pill and opens the molecule normally.

### Link previews

A chat preview of a viewer link to a gallery molecule that has a `/m` page now shows that molecule's ink card instead of the generic image. With `replay=`, the title reads "A shared replay: Caffeine" and the page is noindex. People still get the app. Only link-preview robots get the card page, and `open=1` skips the robot check.

## How it works

| Piece | File |
|---|---|
| Tape types and binary codec (`replay=`, version 1) | `packages/ui/src/replay/tape.ts` |
| Keys: a pose snapshot every 0.5 s, plus extra keys within 0.35°; Hermite playback | `replay/keyframes.ts` |
| The 20 s ring buffer (poses, toy inputs, flashes) | `replay/recorder.ts` |
| Moment detection and the offer | `replay/moments.ts`, `replay/replayStore.ts` |
| Moment to tape to link | `replay/session.ts` |
| Playback (camera, toys, flashes, reframing) | `replay/player.ts` |
| Canvas side (recording, receiving, Your turn, dev hook) | `replay/ReplayDirector.tsx`, `replay/intake.ts` |
| Sheet, clip frames | `replay/ReplaySheet.tsx`, `replay/replaySheet.css`, `replay/clipCompositor.ts` |
| Pill segment (Replay ↗, ▶ Watch, Skip, ↺ Again) and the tray's Replay ↗ | `play/PlayPill.tsx`, `play/PlayTray.tsx`, `play/playPill.css`, `replay/actions.ts` |
| Toys as replayable inputs | `play/toyTape.ts`, `play/PlayLayer.tsx` |
| Frame-exact clip: the frame loop, the frame schedule, the encoder and muxer | `replay/offlineClip.ts`, `replay/clipSchedule.ts`, `replay/clipEncoder.ts` |
| The display-motion clock a clip drives | `play/motionClock.ts`, `play/PlayLayer.tsx` |
| Clip recording in the video export (the fallback) | `ExportManager.tsx` (`replay`, `illustrative`, `compositor`, `signal` on `ExportRequest`) |
| Illustrative recordings, `camera.fling`, job ids | `scene/src/captureGuards.ts`, `intents.ts`, `framePhases.ts` |
| Viewer-link unfurls | `apps/mcp-worker/src/index.ts` (`renderViewerLinkUnfurl`) |

**One decision differs from the write-up.** The camera is stored as keys, not as rig inputs re-simulated with snapshots. Each key is a pose snapshot: one every 0.5 s, plus extra keys where the motion bends. Playback interpolates between them, so a replay cannot drift between browsers or frame rates, and it never depends on Object Facts being ready on the receiving side. Toy inputs are still inputs, re-run by the receiver's Play layer. In a scratch run, a 3 s flick into a face took 35 keys and about 450 base64url characters.

**For agents.** `window.__lupiPlay.replay()` returns `{ moment, keys, events, bytes, link }` for the offered or last moment. `replay('watch')` starts a waiting shared replay, and `replay('moment')` offers the last 4 s as a moment. `replay('clip')` reports the clip rendering now and how the last one was made; `replay('clip-scale', k)` makes the next clips k× the size.

## Frame-exact clips (Sprint S2)

The clip used to be MediaRecorder recording the live canvas in real time. A slow phone dropped frames, and the canvas was resized to 9:16 under the sheet while it recorded. Now the clip is rendered offline, one frame at a time, at a fixed 30 fps on the clip's own clock, so a slow phone and a fast desktop make the same clip.

**For each frame** i, at clip time i / 30 s:

1. The replay player puts a camera of the clip's own (the view's field of view at 9:16, no view offset) at that time on the tape and fires the toy inputs that are due. The live camera never moves.
2. The display-motion clock steps by exactly 1/30 s (`play/motionClock.ts`). The Play layer advances the toys by the time between drawn frames; while a clip renders, that time is the clip's: 1/30 s for each clip frame and nothing for frames in between. A burst or a tug is where it would be at that time, whatever the device's frame rate.
3. The next drawn frame renders the scene with the clip camera through the export capture engine (`renderSceneToPixels`): at the clip size, 2× supersampled, with the viewer's configured look, and `illustrative`, which skips the capture guards. Display motion, the overlays riding it and a Foil finish stay on, as on screen; no export, thumbnail or MCP artifact ever shows them. The recording guard (`beginRecording({ illustrative: true })`) holds the hover glow off and the camera rig still, as for any recording.
4. The compositor puts the pixels on its canvas and burns in the labels. The pill's flash is read from the tape on the clip's clock (a face's name shows for as long as it did on the sender's pill), not from the live pill.
5. `VideoEncoder` encodes the frame with timestamp round(i × 10⁶ / 30) µs, a keyframe every 2 s, and `mp4-muxer` writes it into an MP4 with its index up front.

**The codec** is the first of this ladder that `VideoEncoder.isConfigSupported` accepts at the clip's size, at the lowest level that holds the frame:

| Codec | 720×1280 | 1080×1920 |
|---|---|---|
| H.264 High | `avc1.64001F` | `avc1.640028` |
| H.264 Constrained Baseline | `avc1.42E01F` | `avc1.42E028` |
| VP9 profile 0, 8-bit | `vp09.00.31.08` | `vp09.00.40.08` |
| AV1 Main, 8-bit | `av01.0.05M.08` | `av01.0.08M.08` |

H.264 comes first because it plays everywhere a clip is posted. The file is always `.mp4` (`video/mp4`); the sheet names the codec ("MP4 clip (H.264), 9:16 · Illustrative").

**The live view** keeps its size and its last picture. While the clip renders, ReplayDirector mounts a job in fiber's `render` phase that draws nothing, which takes the frame's render over: the device draws one picture per frame, the clip's, not two. The Play layer and every uniform job still run. The sheet covers the view and shows the frames as they are composed, with the progress.

**Fallback.** Without WebCodecs, or without any of the four codecs, the clip is recorded in real time through the video export with MediaRecorder, exactly as before. So is a clip whose encoder fails mid-way (the console says so).

**Still non-artifacts.** Clips and replays have no artifact identity, and MCP cannot ask for them.

## Try first

1. **C60 on desktop.** Flick it hard and let it click into a face. Tap **Replay ↗**, watch the clip develop, then Copy link. Open the link in another browser or in a private window: it should play, then say "Your turn · flick it".
2. **The same link on a phone.** Check the reframing (the desktop moment should fit the narrow screen), then take over mid-replay with a touch.
3. **Caffeine, Play › Burst.** Pop it a few times and let it settle. Replay ↗, then **Share clip + link** into Messages on the iPhone. Check that the clip carries "Illustrative motion" and ends on "Your turn". On the receiving side, Burst should be latched.
4. **Play › Spin on caffeine** (the flip), and three arrow-key hops on C60 (the chain).
5. **Motion: Still** on both ends. The offer should read Share ↗, the link should open on the pose, and nothing should move. Then Gentle on the receiving end: ▶ Watch should be needed.
6. **A link pasted into a chat** (`/play?sim=caffeine&replay=…`; `/play` is Worker-first and sends people on to `/?…`). The preview should be the caffeine ink card titled "A shared replay: Caffeine".

## Tuning points

| What | Value | File |
|---|---|---|
| Ring buffer | 20 s | `replay/recorder.ts` |
| Offer | 7 s on the pill; moment window lead 0.35 s, tail 0.5 s, at most 8 s (the end kept), at most 1.2 s of the drag before a flick | `replay/moments.ts` |
| Good flick | turned ≥ 1.2π, or ≥ π/2 into a named face | `moments.ts` |
| Chain | 3 faces, each within 4.5 s of the last | `moments.ts` |
| Toy moment | any burst or scatter; a tug with ≥ 4 pulls; heat held ≥ 0.8 s; ≥ 6 stirred ripples; ≥ 5 atom taps | `moments.ts` |
| Keys | snapshot every 0.5 s; tolerance 0.35°, 0.4 % distance, target 0.3 % of distance; at most 360 keys; a link over 2,600 characters is rebuilt with looser keys | `replay/keyframes.ts`, `replay/session.ts` |
| Receiving | autoplay 0.7 s after the arrival; "Your turn" 3.6 s; ↺ Again 9 s | `ReplayDirector.tsx`, `PlayPill.tsx` |
| Reframing | the molecule's bounding sphere × 1.08 fits the narrower side; zoom between × 0.45 and × 2.4 | `replay/player.ts` |
| Clip | 720×1280 on phones, 1080×1920 on desktop, 30 fps, 8 Mbps; end card 0.9 s | `offlineClip.ts`, `clipCompositor.ts`, `ExportManager.tsx` |
| Frame-exact clip | supersampling 2× (`CLIP_SUPERSAMPLE`); a keyframe every 60 frames; at most 4 frames queued in the encoder; codec ladder above | `offlineClip.ts`, `clipEncoder.ts` |

## Half-done and known limits

- **The real-time fallback keeps its limits.** Where the clip is still recorded with MediaRecorder (no WebCodecs, or no codec), a slow phone can drop frames, the live canvas is briefly resized to 9:16 under the sheet's veil, and if a browser cannot draw the viewer canvas into the clip compositor, the clip records the canvas itself, without the burned-in labels (the console says so).
- **A frame-exact clip takes as long as the device needs.** Nothing has been timed on a GPU yet. On SwiftShader (headless Chromium, 4 CPUs shared at a load average of 60 to 80) a quarter-size clip (270×480) took 3.0 to 4.1 s a frame on WebGL2 and 8.9 s on WebGPU, almost all of it the frame's render and readback (composing and encoding took 1 to 12 ms a frame); a full-size 1080×1920 frame took 31 s on WebGL2, after 41 s for the first. The sheet shows the progress, and closing it (or Esc) cancels the clip and the live view draws again.
- **Headless Chromium encodes no H.264.** Its `VideoEncoder` accepts VP9 and AV1 at 1080×1920 and neither H.264 profile, so the local smoke's clips are VP9 in MP4 (which it also plays back, so the sheet's preview is no longer blank there). H.264 is untested until a browser with an encoder (Safari, Chrome) makes one.
- **What does not follow the clip's clock:** a moving procedural background, the selection ring's pulse and a Foil reveal sweep run on wall time, so on a slow device they move faster in the clip than they did on screen.
- **What a replay does not carry:**
  - the sender's hand-tuned Look (background, material): it plays in the visitor's own view. Since the merge, the link does carry the sender's Remix code (`remix=`, when the look is exactly a code) and the Illustrate look (`ink=f|h`);
  - trajectory playback (a moment records the frame it started on, not playback);
  - the sender's selection and atom card.
- **Unfurls are for gallery molecules with a `/m` page only.** A `/?load=` link still unfurls with the generic card. The unfurl image is the molecule's card, not the moment's hero frame.
- **Moment thresholds are first guesses,** like everything else in this wave. So is the pill offer's length.
- **A takeover mid-tumble** rights the camera with a short glide. A takeover during the first frames can briefly show the gallery fit before the moment's first pose.
- **Not built:** a storyboard of stills for reduced motion (Still opens on the last pose instead), toy-only Remix rolls, and analytics events.
