# Wave 2: status

Wave 2 was built in three parallel tracks from `1ce1b94` and merged on `claude/math-graphics-viewer-brainstorm-5wxur4`:

- **`w3/engine`:** Quiet Idle, self-hosted HDRs, the Tug, Burst and Heat toys, and the hover glow.
- **`w3/look`:** contact occlusion, the floor shadow, one softbox rig, and exports that carry the look.
- **`w3/phone-ui`:** the phone Switch caption, the compact atom card, and the `/m/<id>` molecule pages and unfurls.

The owner's rule for this wave was build, build, build. The only checks were TypeScript builds, lint, the existing unit tests, the Cloudflare build and tests, the product contract and the web build. **Nothing in this wave has been seen running in a browser.** Every tuning value is a first guess, waiting for the owner's phone and desktop.

## What shipped for a visitor

### The viewer stops drawing when nothing moves (Quiet Idle)

- **Draws only on change.** The canvas runs on demand, so a still molecule costs no GPU work.
- **Keeps drawing while:** the camera drags, coasts, glides or zooms; display motion runs (arrival, ripple, Scatter, Tug, Burst, Heat); a trajectory plays; a flythrough previews; the phone card's view shift moves; or an export waits on its scene.
- **Wakes on:** the first touch or wheel, any store write (looks, selection, hover, MCP), bond, environment and contact-occlusion loads, a background swap, the tab coming back, a resize or a DPR change.
- **Moving backgrounds and halo annotations** run at 24 fps when nothing else moves, and Still holds them.
- **The selection ring** pulses for 2.4 s, then rests. Gentle halves the pulse and Still skips it.
- **Recording.** A video recording renders continuously and draws the restored view afterwards.
- **Frame counter.** `__lupiPlay.state().frames` counts drawn frames, and `.frameDemand.awakeBy` names what keeps the loop awake (for example `viewInset`, `playback` or a display-motion keeper).

### Three new one-finger verbs and a hover glow

- **Play tray.** The One finger row is now Orbit, Poke, Tug, Burst and Heat. Picking a verb latches it: the pill reads "Tug ×", "Burst ×" or "Heat ×" with its own dot and a one-line hint. The verb unlatches after 30 s idle, on a new file, or under Still. The palette can switch verbs too.
- **Tug.** Drag an atom and its neighbourhood follows on springs, like a rubber band that widens as it stretches. On release it twangs home past rest. The grabbed atom glows lime. With no atom under the finger, Tug pulls the point in space instead.
- **Burst.** Each tap pops the atoms out from the tapped point and springs them back. While Burst is latched, taps never select an atom, and a drag still turns the molecule.
- **Heat.** Hold to make the atoms jiggle. The jiggle grows while you hold, rubbing warms the atoms faster, and they cool on release. They take a warm tint, the viewport edge glows, and the pill shows an illustrative thermometer from 300 K to about 1,800 K.
- **Bonds under the toys** thin like taffy and glow lime with strain.
- **Hover glow (desktop).** The atom under the cursor gets a soft lime rim and a slight swell. Selected atoms get a stronger rim (up to four). Selection rings are lime and hide while toys move atoms. The old hover ring remains only with Refractive glass, where the pill says "Toys rest with Refractive glass".
- **Keyboard.** With a verb latched, Enter plays it on the selected atom (or the middle of the molecule). Holding Enter heats.
- **Honesty.** "Illustrative · Reset" shows whenever atoms are displaced. Gentle halves the motion, and Still turns the verbs off. Exports, MCP artifacts, thumbnails and video never carry toy motion or glow.
- **Sound and haptics** cues exist for grab, release, burst and each 300 K of heat. They stay off unless turned on in Settings.

### The look: crevices, a floor and one softbox

- **Contact occlusion on every device.** Each atom remembers its 8 nearest neighbours, and the shader darkens the side facing them, with dark rings where bonds meet balls. It is baked once and costs nothing per frame. It runs up to 60k atoms on phones and 250k on desktops. It eases open while display motion carries atoms (arrival, scatter, the toys) and is whole in exports.
- **A floor shadow under every molecule** up to 50k atoms, not only when the cell is shown. It sits just under the lowest atom, gets softer with height, and leans away from the key light. It fades as the camera drops toward the floor and during arrival and scatter. It is off for Diagram and under the filter shell.
- **One softbox key across all Looks.** Phones draw the same softbox catchlights as desktop. On desktop the softbox follows the key, fill and rim lights. Looks no longer go flat above 25k atoms.
- **Neutral tone mapping.** Paper and Studio now use Neutral, which keeps CPK colours true. It is also offered as "True colour (Neutral)".
- **Exports carry the look.** Exports, MCP images and saved-view thumbnails now include AO, bloom, depth of field, tone mapping and vignette.
  - **No seams.** The look runs once over the whole assembled image, so a 2160 px export has no tile seams.
  - **Same on every device.** Exports never use the phone budget, so a phone export matches a desktop one.
  - **Transparent output** gets AO and tone mapping only.
  - **Diagram** exports are byte-for-byte the old raw output.

### Phone layout

- **Switch panel.** The particle stage takes the full width (164 px) with nothing on top of it. The conclusion is a two-line caption under the stage: "LOOKS LIKE **Candy**" with its confidence chip, then Jev's likeness bar and judgment count. While the shape forms, the caption reads "Sketching candy…" with a shimmer, so the layout does not jump.
- **Atom card.** The card opens as a compact sheet under the header: the element tile, name, category and role, one line of facts, and Details (the full card, sticky for the session).
  - **The molecule moves into view.** It eases down into the free band between the card and the Play pill, by at most 30 % of the screen. It waits out the double-tap window first. Still makes it cut, and closing the card eases it back.
  - **Display only.** The view shift never touches the stored camera, saved views, share URLs, the axes gizmo, picking, exports, thumbnails or video.

### Sharing: `/m/<id>` pages and real link previews

- **`/m/<id>` molecule pages** for the 69 small gallery molecules. Each is static HTML with no canvas:
  - a spinnable ink drawing with the hero's feel, which clicks onto ring and axis views and names them;
  - the formula, atom count, molar mass, names, handbook values, an element strip, a "Try this" prompt, sources and six related molecules;
  - **Open in 3D**, at the angle you left the drawing;
  - **Place on your desk** (AR Quick Look on iOS, Scene Viewer on Android; on desktop, links to the USDZ and GLB files);
  - **Share**.
- **`/m/`** is an A–Z index by shelf with a name-or-formula filter, linked from the landing footer.
- **Link previews.** Every page has its own 1200×630 card (the ink drawing on the sage plate), Open Graph and Twitter meta, structured data and a sitemap entry. A saved view of a gallery molecule unfurls with that molecule's card. Any other saved view unfurls with its own saved picture at `/view/<slug>/card.jpg`.
- **Links in.** Wall tiles, library cards and home search results link to `/m/<id>`. A plain click still opens the viewer in place.
- **In the viewer.** The header shows "About" for gallery molecules. Before a view is saved, the Save panel offers "Share this molecule" with the `/m` link, no sign-in needed.

### Self-hosted environments

- **Served from `/hdri/`.** All seven HDR environments now load from Lupi's own domain, cached as immutable.
- **Unchanged identity.** They are the same bytes as before, so no `specId` changes.
- **Fallbacks.** If a file fails, the viewer tries the old raw.githack.com address, then plain lighting.
- **Licence.** `apps/web/public/hdri/NOTICE.md` records the Poly Haven CC0 licence.

## Escape hatches

| URL flag | What it does |
|---|---|
| `?frameloop=always` | Continuous rendering again. Try it first if something looks frozen until the next touch. |
| `?controls=orbit` | The old OrbitControls instead of the Lupi camera rig. |
| `?frames=1` | A small sage/lime meter at the top of the viewer: fps, idle or awake, and the frame count (for checking idle on a phone). |
| `?renderer=webgl2` | Forces the WebGL2 backend. |

`frameloop` and `frames` also work inside a hash route (`#/mcp?frameloop=always`). `controls` and `renderer` are read from the page query only (`/?controls=orbit#/mcp`).

## Try first

1. **A phone, any molecule, `?frames=1`.** Leave it still, and the counter should stop. Drag, flick, tap an atom and watch it wake and settle.
2. **Tug, Burst and Heat on caffeine and C60** (Play tray, One finger), on phone and desktop. Check the feel, then Gentle and Still.
3. **On a phone, tap an atom.** The compact card should open and the molecule should ease into the free band. Then close it.
4. **The new look, on Paper and Studio** (Neutral, crevices, floor shadow), then a PNG export of the same view. The export should now look like the screen.
5. **`/m/caffeine`, and a `/m/caffeine` link pasted into a chat** for the card. Then Open in 3D, and Place on your desk on an iPhone.

## Half-done and known limits

- **Possible frozen frames.** Anything that changes the scene without one of the wake-ups above would freeze until the next touch. `?frameloop=always` rules this in or out.
- **FPS readouts read zero at idle.** DevProbe and the label HUD show 0 fps on a still view.
- **Toys are untuned.** Strengths, springs, the heat ramp and the glow strength are first guesses. The values are in the table in [wave1-status.md](wave1-status.md).
- **Overlays stay at rest positions.** Labels, the atom card and trails do not follow toy motion; only selection rings hide.
- **CPU twin.** The twin mirrors the arrival and the ripple, not Tug, Burst or Heat.
- **Large files and playback.** Tug and Burst fall back to the point under the finger, because there is no atom picking there.
- **Toys not built:** two-finger taffy, the strain meter, GPU ID picking, Knife, Lasso and Wake.
- **Look tuning is unchecked.**
  - **Phone vs desktop brightness.** The phone and desktop softbox strengths were matched on paper only.
  - **Neutral vs ACES.** Neutral will look noticeably different from today's stills.
  - **No off switch.** No setting turns off contact occlusion or the floor shadow.
  - **Shadow during arrival.** The floor shadow fades in during an arrival rather than following the atoms.
- **Render-artifact spec changed.** `view.postprocess` gains a `viewer-look` form, and the softbox environment identity moved to v2. The V2 parity candidates must be re-derived on both backends (`pnpm verify:render-parity -- --backend=<webgpu|webgl2> --derive-candidate`, a local check).
- **Exports with a look** use more GPU memory during capture. For 12k–250k atoms, deterministic exports wait for the contact-occlusion worker bake.
- **Phone view shift.** It does not zoom out, so a tall structure can still slide partly under the Play pill. Closing the card with ✕ waits about 360 ms before easing back. The Learn, Data and Style panels still cover the molecule on phones.
- **Molecule pages.**
  - **Not covered:** molecules over 600 atoms, trajectories and LAMMPS-format gallery files have no `/m` page.
  - **Generic card on viewer links.** A copied viewer address (`/?sim=…`) still unfurls with the generic card.
  - **No per-view cards.** Saved-view cards are not drawn from the view's own camera.
  - **Untried in dev.** `pnpm dev` support for `/m` has not been tried.
  - **Build cost.** The web build takes about 20 s longer and adds about 20 MB of cards and models.
- **Test stubs.** The `tests/ui` specs and the smoke tool still stub raw.githack.com HDR addresses, which the viewer no longer requests first. CI exports may load the real 1k HDRs and run slower.
- **One engine commit does not build on its own.** `2871a31` does not build alone; the branch builds from `23c285b` on.

## Look tuning points

| Where | Value | File |
|---|---|---|
| Contact occlusion | strength 1.4, 8 neighbours, darkening capped at 0.82; up to 60k atoms on phones, 250k on desktops | `scene/src/atomContactOcclusion.ts`, `ui/src/app/ViewerScene.tsx` |
| Floor shadow | opacity 0.5 (0.62 on Editorial and Cinematic), blur 2.2, spread 0.3, lean 0.33; camera fade from about 13° to 2° above the floor; up to 50k atoms | `ui/src/specimenShadow.ts`, `ui/src/LupiContactShadow.tsx` |
| Screen-space AO | Paper 0.85, Studio 1.2 | `ui/src/postprocess/presets.ts` |
| Phone view shift | at most 30 % of the canvas height, 12 px gap, holds one double-tap window (about 360 ms) | `ui/src/camera/viewInset.ts`, `ViewInsetDriver.tsx` |
| Quiet Idle | 2 frames and a 160 ms settle per request; ambient motion at 24 fps; selection pulse 2.4 s | `scene/src/frameDemand.ts` |
