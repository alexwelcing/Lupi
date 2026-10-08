# Export System — Evaluation & Flythrough Resurfacing

## What we asked
"Is every export option actually working? And bring back the old Lupine
flythrough-for-export where you select spot, spot, spot, transition, and export
a video."

## What the audit found
The export system is **complete and functional** — and the historic Lupine
flythrough system is **already present in Lupi, unchanged**. Both repos carry
the identical implementation (Lupine commit `bbec008`): `flythrough.ts`,
`FlythroughPanel.tsx`, `ExportManager.tsx`. Nothing needed porting.

Every export control reaches a real implementation (verified handler-by-handler):

| Control | Status |
|---|---|
| PNG / JPG (arbitrary resolution) | ✅ works |
| Study sheet (print/PDF, embeds a render) | ✅ works |
| GLB / USDZ (3D + AR, instanced-mesh dedup) | ✅ works |
| MP4 orbit (360°) | ✅ works |
| MP4 auto-flythrough (procedural path) | ✅ works |
| **Custom flythrough** (place stops, easing, hold, preview, share, MP4 export) | ✅ works |

Video uses native `MediaRecorder` + `canvas.captureStream` (mp4 on Safari/iOS,
webm on Chromium/Firefox), off-thread, with `showSaveFilePicker` + download
fallback. The flythrough path interpolates with Catmull-Rom splines through
2–5 camera stops, 6 easing curves, per-stop hold/transition times, and is
sampled frame-accurately during recording. **No stubs, no dead handlers.**

## The real problem: discoverability
The custom flythrough editor (`FlythroughPanel`) was **orphaned** — reachable
only via the command palette or a `?fly=` URL. It had no entry point from the
Export surface, which is why it felt "gone." The Export panel itself was a flat,
ungrouped list of seven mixed buttons.

## What changed
- **Export panel reorganized into clear sections** — Image · 3D model · Video —
  instead of one undifferentiated grid.
- **Resurfaced the custom flythrough** as a first-class "Custom flythrough"
  entry in the Video section ("place camera stops → video"). It opens the full
  editor (which already works on both the desktop dock and the mobile sheet via
  the shared `ViewerPanelBody`).
- **Taller mobile sheet** for the content-heavy editors (studio, flythrough,
  export) so the sequencer is usable on a phone.
- Clearer video labels ("Auto flythrough" + "360° orbit · 5s" / "auto camera
  path · 5s").

## Verification
- `tsc --noEmit` clean across the monorepo; `store.test.ts` 22/22.

## Possible follow-ups (not done — would extend the feature, want a green light)
- Lift the 5-stop limit (currently capped in the store) if longer paths are wanted.
- Per-stop resolution / fps choice for the custom flythrough (today fixed 1080p/30).
- "Click an atom to drop a camera stop" capture flow.
- Per-stop visualization overrides (color/scene) — not in the historic version either.
