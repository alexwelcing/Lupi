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
  - **A 9:16 clip**, recording right away in the sheet's preview. It is 720×1280 on phones and 1080×1920 on desktop, MP4 where the browser records MP4 (Safari) and WebM elsewhere. It is the normal video export, replaying the moment off screen with the toys allowed. Every frame carries the molecule's name, "Illustrative motion · lupi.live" and the pill's flash as it played (for example "Pentagon face-on · 5-fold axis"). It ends on a sage card reading "Your turn" with the molecule's `/m` page.
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
| Clip recording in the video export | `ExportManager.tsx` (`replay`, `illustrative`, `compositor`, `signal` on `ExportRequest`) |
| Illustrative recordings, `camera.fling`, job ids | `scene/src/captureGuards.ts`, `intents.ts`, `framePhases.ts` |
| Viewer-link unfurls | `apps/mcp-worker/src/index.ts` (`renderViewerLinkUnfurl`) |

**One decision differs from the write-up.** The camera is stored as keys, not as rig inputs re-simulated with snapshots. Each key is a pose snapshot: one every 0.5 s, plus extra keys where the motion bends. Playback interpolates between them, so a replay cannot drift between browsers or frame rates, and it never depends on Object Facts being ready on the receiving side. Toy inputs are still inputs, re-run by the receiver's Play layer. In a scratch run, a 3 s flick into a face took 35 keys and about 450 base64url characters.

**For agents.** `window.__lupiPlay.replay()` returns `{ moment, keys, events, bytes, link }` for the offered or last moment. `replay('watch')` starts a waiting shared replay, and `replay('moment')` offers the last 4 s as a moment.

## Try first

1. **C60 on desktop.** Flick it hard and let it click into a face. Tap **Replay ↗**, watch the clip develop, then Copy link. Open the link in another browser or in a private window: it should play, then say "Your turn · flick it".
2. **The same link on a phone.** Check the reframing (the desktop moment should fit the narrow screen), then take over mid-replay with a touch.
3. **Caffeine, Play › Burst.** Pop it a few times and let it settle. Replay ↗, then **Share clip + link** into Messages on the iPhone. Check that the clip carries "Illustrative motion" and ends on "Your turn". On the receiving side, Burst should be latched.
4. **Play › Spin on caffeine** (the flip), and three arrow-key hops on C60 (the chain).
5. **Motion: Still** on both ends. The offer should read Share ↗, the link should open on the pose, and nothing should move. Then Gentle on the receiving end: ▶ Watch should be needed.
6. **A link pasted into a chat** (`/?sim=caffeine&replay=…`). The preview should be the caffeine ink card titled "A shared replay: Caffeine".

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
| Clip | 720×1280 on phones, 1080×1920 on desktop, 30 fps, 8 Mbps; end card 0.9 s | `ReplaySheet.tsx`, `clipCompositor.ts`, `ExportManager.tsx` |

## Half-done and known limits

- **The clip is recorded in real time with MediaRecorder,** not frame-stepped. A slow phone can drop frames. The Shot's frame-exact encoder ladder (Mediabunny, gifenc) is not built.
- **Recording takes over the canvas.** While the clip records, the live canvas is briefly resized to 9:16 under the sheet's veil, as the video export always did. The sheet's preview shows the frames as they are composed.
- **Fallback without labels.** If a browser cannot draw the viewer canvas into the clip compositor, the clip records the canvas itself, without the burned-in labels (the console says so).
- **What a replay does not carry:**
  - the sender's Look (background, material), on purpose: it plays in the visitor's own view;
  - trajectory playback (a moment records the frame it started on, not playback);
  - the sender's selection and atom card.
- **Unfurls are for gallery molecules with a `/m` page only.** A `/?load=` link still unfurls with the generic card. The unfurl image is the molecule's card, not the moment's hero frame.
- **Moment thresholds are first guesses,** like everything else in this wave. So is the pill offer's length.
- **A takeover mid-tumble** rights the camera with a short glide. A takeover during the first frames can briefly show the gallery fit before the moment's first pose.
- **Not built:** a storyboard of stills for reduced motion (Still opens on the last pose instead), the remix or look code in links, toy-only Remix rolls, and analytics events.
