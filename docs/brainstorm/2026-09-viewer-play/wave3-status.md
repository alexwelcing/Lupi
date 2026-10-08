# Wave 3: status

Wave 3 was built in three parallel tracks from `df1aa66` (wave 2) and merged on the local branch `wave3`:

- **`w4/phone`** (18 commits): phone sheets that make room for the molecule, and overlays that ride the toys.
- **`w4/share`** (21 commits): Instant Replay (a live link and a 9:16 clip of a good moment), and Remix codes with Foil.
- **`w4/daily`** (25 commits): Lupi Daily at `/daily`, the Illustrate look (Ink and Sketch), ink tiles and Ink-to-Light.

The owner's rule held for this wave: build, build, build. The only checks were the TypeScript builds, lint, the existing unit tests (core 153, scene 119, ui 701, worker 91, web 4), the Cloudflare build and tests, the product contract and the web build. **Nothing in this wave has been seen running in a browser.** Every tuning value is a first guess, and the new shaders compile for the first time on the owner's device.

Detailed write-ups, with their own tuning tables:

- [wave3-instant-replay.md](wave3-instant-replay.md)
- [wave3-remix-codes.md](wave3-remix-codes.md)
- [docs/daily.md](../../daily.md)
- [docs/ink-and-light.md](../../ink-and-light.md)

## What shipped for a visitor

### Phone sheets make room for the molecule

- **Every panel is a bottom sheet** when the phone is upright: Style, Data, Camera, Export, Switch, Settings, Path and Learn. Each sits above the command bar instead of covering the screen.
  - **Three heights.** The handle or title bar drags the sheet between Peek, Half and Full. A flick carries it to the next height, and a swipe down past Peek closes it. Tapping the handle steps through the heights; arrow keys, Home and End work on it.
  - **Memory.** Each panel reopens at the height it was left at, for the session.
- **The molecule moves into the free space.** It shifts, and shrinks to fit when it has to (never grows, never below 0.42 of its size). It follows a sheet while you drag it and settles gently otherwise. Still cuts both the sheet and the molecule; Gentle still glides.
- **Held sideways,** panels are a column on the right and the molecule moves left.
- **Everything that covers the canvas makes room:** the atom card (✕ now eases back at once), the Play tray (after 420 ms, so a quick pick moves nothing), Save, Account, Saved views, and the Remix sheet.
- **Switch while looking.** The Switch sheet opens without the keyboard and stays open after a pick, so each new molecule lands framed above it.
- **Style no longer resizes the canvas** on a phone, so it no longer refits or rewrites the stored camera.
- **Display only.** Exports, MCP artifacts, thumbnails, video, saved views, share URLs and the axes gizmo never see the shift, and taps still land on what is drawn. Desktop is unchanged.

### Overlays ride the toys

- **Rings, labels and lines stay on their atoms** through the arrival, Poke, Scatter, Tug, Burst and Heat, and are back exactly at rest when the motion ends. The wave-2 workaround that hid selection rings during toy motion is gone.
- **What follows:**
  - selection, hover and neighbour rings;
  - annotations in all four styles, atom-tied knowledge labels and the desktop atom card (labels take a fifth of Heat's jiggle, so they stay readable);
  - measurement lines (the number always shows the true rest value);
  - trails (their newest 8 samples bend toward a displaced atom);
  - vector glyphs (on the GPU, with the same offset as the atoms).
- **At rest in every artifact.** Exports, MCP images, thumbnails and ordinary video show overlays at rest. Under Refractive glass, overlays stay put, because the glass atoms do not move either.

### Instant Replay

- **The offer.** After a good flick, a chain of three named faces, a Spin flip or a toy moment, the pill shows **Replay ↗** for 7 s (one more segment of the same pill). **R**, the Play tray's last row and the palette open it at any time; with no moment they share the current view.
- **The sheet.** The live link is ready at once (Copy, Share): `replay=` holds the moment, about 0.5 to 1.5 KB, with nothing stored. A 9:16 clip records straight away (720×1280 on phones, 1080×1920 on desktop), labelled "Illustrative motion · lupi.live" on every frame, with the face names as they flashed, and ends on a sage "Your turn" card. Then "Share clip + link" and "Save clip".
- **Receiving.** The link opens the molecule at the moment's first pose and plays it in the visitor's own 3D view, reframed for their screen. Standard plays on its own, Gentle waits for **▶ Watch**, and Still opens on the last pose. Any touch takes over; **Skip** jumps to the end. It ends on "Your turn · flick it", and a toy moment latches that toy.
- **Link previews.** Replay and Remix links to a molecule with an `/m` page are shared as `/play?sim=<id>…` (a Worker-first path; people are redirected to `/?…`) and unfurl with its ink card. This closes the wave-2 generic-card limit. A replay's title reads "A shared replay: <name>".
- **Motion: Still.** The offer reads **Share ↗**, the link opens on the final pose, and no clip is made.

### Remix codes and Foil

- **Every Remix has a code** such as `r1-K7QDM`. A code gives the same look on any device and any molecule. `r1` names a frozen catalog, and a new catalog would be `r2`, so `r1` codes keep working.
- **Remixed views stay exportable.** The catalog never adjusts a gradient backdrop and never picks the glass material.
- **Ways to roll:**
  - **Remix ⟳** in the Play tray's Look row (the tray stays open for the next roll);
  - **⟳ Again** on the pill for 8 s;
  - **M** (Shift+M steps back, up to eight looks);
  - the scene deck and the palette;
  - **Shake to roll** on phones, off until turned on in the Remix sheet.
- **Looks morph in about 600 ms** instead of snapping: lights swing, colours blend, plain gradient backdrops cross-fade. The deck's Looks morph too, and Still cuts.
- **Atom colours stay CPK** by default, and a code follows the visitor to the next molecule.
- **Foil** comes up on about 1 roll in 24: Holo, Gold leaf or Pearl.
  - A code is Foil or not by the code alone, so a shared Foil is Foil for everyone.
  - The pill reads "✦ Holo foil · r1-…" and a bright band sweeps across the molecule. The tray and the sheet print the odds: "Foil 1 in 24 · each finish 1 in 72".
  - A finish you roll stays selectable on that device, and "Show all finishes" unlocks all three.
  - No export, thumbnail, MCP image or ordinary video carries a finish. Instant Replay's clip keeps it and labels it.
- **The Remix sheet** (the tray's code chip): Roll, Undo, Copy code, Copy link, Share look (`?remix=`), a field for typing or pasting a code or a link, the finishes and preferences. A card at the right on desktop; on a phone a short bottom sheet that the view makes room above. Pasting an `r1-` code anywhere outside a text field applies it.

### Lupi Daily

- **`/daily/`:** one mystery molecule a day, the same for everyone, rolling over at local midnight. No. 1 is 2026-10-01, so 2026-10-03 is No. 3.
- **Six clues, each a drawing plus words:**
  1. a still ink silhouette;
  2. the silhouette turning, with the elements;
  3. an outline with bonds and rings;
  4. CPK colour and the formula;
  5. a room-temperature property and molar mass;
  6. the name's letters hidden.
- **Guessing.** A type-ahead over the 69 molecule names and about 67 more common molecules (guessable, never the answer). Each wrong guess gets a warmth score from 0 to 99 and opens the next clue.
- **Solving** blooms the paper disc into the lit drawing on the sage plate with a lime ring, and the name rises letter by letter. **Open in 3D** hands the pose to the viewer.
- **Sharing** never names the answer: "Lupi Daily No. 3 · Sat 3 Oct / Solved on clue 3 of 6", coloured squares and the date's link. Every date page has its own 1200×630 silhouette card.
- **Stats** (played, solved %, streak, best streak, wins by clue) stay in this device's localStorage.
- **Also on the page:** this week's strip, yesterday's answer on tap, the countdown, past dates as practice, "No peeking" for later dates, and **`/daily/text`**, the same game in words.
- **Links in:** a Daily card on the home page under the hero, the site header and footer, the `/m` pages and index, and a palette entry in the viewer.

### The Illustrate look, ink tiles and Ink-to-Light

- **Two new Looks.** **Illustrate** is flat colour on the sage plate. **Sketch** is pen hatching on a paper plate (`#e7ebe3`).
  - Three bands of colour from the key light plus a small highlight; crevices from the baked contact occlusion.
  - An ink outline on every atom and bond, with thin bonds becoming a single stroke.
  - The back of the molecule fades toward the plate.
  - It is drawn inside the impostor shaders, so WebGPU and WebGL2 match.
- **Where to find it:**
  - Style → Looks;
  - the Play tray's Look row (Lit · Ink);
  - the palette (Ink, Sketch, Lit) and the **I** key;
  - an Ink section under All visual mods (style, weight, plate);
  - MCP: `lupi.set_viewer { inkStyle, inkWeight }`.
- **A Look, not toy motion.** It rides share links, saved views and remembered settings, and carries over to the next molecule. Exports draw it at the export's line weight. While it is on, the effect recipe steps aside. Changes fade over about half a second, and every capture renders the chosen look, never a half-fade.
- **Ink tiles.** Wall tiles, finder results, library cards and the viewer's switcher show each molecule's own `/m` ink drawing. A tap lights the tile lime, and the relay grows the drawing to the 3D view's size. While the viewer loads, you can turn it like the hero.
- **Ink-to-Light.** A molecule opened from the hero, an `/m` page, the Daily or an ink tile first draws in ink at the pose you left, then the light comes on. Any touch completes it; Still skips it.

### How the three tracks fit together

These are the merge's own decisions; each feature also survives on its own.

- **One Look row in the Play tray:** Lit · Ink · Remix ⟳ on one line, the code chip across the line under it, and the published Foil odds under that.
- **Foil rests under ink.** A drawing carries no foil: the finish fades out as the ink fades in (`lupiFoilFinish` takes the ink weight as `mute`), and comes back when the light does.
- **Remix and ink compose.** A roll keeps the drawing, re-shading it under the new light and backdrop. A Look picked from the deck sets ink and the light together, and the ink fade now runs alongside the 600 ms morph, not after its midpoint.
- **Links carry the look.** Replay links carry the sender's Remix code (`remix=`) and, while ink is on, the drawing (`ink=f` or `ink=h`). "Share look" adds `ink=` too. The viewer reads these as it boots and drops them from the address bar.
- **One sheet at a time on a phone.** The Remix sheet declares its area like every phone sheet, and opening it from the Style sheet's deck closes the Style sheet first.
- **Keys:** R is Replay, M and Shift+M are Remix, I is Ink.
- **Frame demand.** Every new animator keeps the Quiet Idle loop awake only while it moves: the replay player, the Foil sweep and fades, the Remix backdrop fade, the morph's store writes, the ink fades and Ink-to-Light, the sheet drags and the overlay follow.

## Wave-2 limits this wave closes

- **Overlays stay at rest positions:** fixed. They now follow the toys.
- **The CPU twin covers only the arrival and the ripple:** fixed. It mirrors Tug, Burst and Heat too.
- **Phone view shift:**
  - The shift could not zoom out: it now shrinks the molecule to fit.
  - ✕ waited about 360 ms before easing back: it now eases at once.
  - Learn, Data and Style covered the molecule: every panel now makes room.
- **Generic card on viewer links:** fixed for gallery molecules with an `/m` page.

## Console and URL handles

| Handle | What it does |
|---|---|
| `__lupiPlay.viewInset()` | `{ current, target, occluders }`: the phone framing and which sheets have declared an area. |
| `__lupiPlay.follow()` | `{ moving, followers, displaced, points, maxOffset }`; `displaced` and `maxOffset` are 0 at rest. |
| `__lupiPlay.replay()` | The offered or last moment as `{ moment, keys, events, bytes, link }`; `replay('watch')` starts a waiting shared replay. |
| `__lupiPlay.remix()` | `{ code, foil, finish, status, morphing }`; `remix('roll')`, `remix('undo')`, `remix('r1-K7QDM')`. |
| `__lupiPlay.ink()` | `{ mix, hatch, weight, target, holding, fading, arrival }`. |
| `?replay=…` | A shared moment (read once, then dropped from the address bar). |
| `?remix=r1-…` | A shared look. |
| `?ink=f` / `?ink=h` | The Illustrate look (flat or hatched). |

Wave 2's escape hatches still apply: `?frameloop=always`, `?controls=orbit`, `?frames=1` and `?renderer=webgl2` ([wave2-status.md](wave2-status.md#escape-hatches)).

## Try first

1. **Phone upright, caffeine.** Open Style and watch the molecule ease up. Drag the handle to Peek and to Full, flick it, and swipe down to close. Then try Switch at Half and pick a few molecules: each should land framed above the sheet.
2. **Desktop, caffeine, overlays on the toys.** Select an atom, then Tug it and let go: the lime ring should ride the atom home. Add an annotation (Shift-click) and Heat it, then Burst near a measured distance. Export a PNG mid-motion: everything should be at rest.
3. **C60, Instant Replay.** Flick it hard into a face, tap **Replay ↗**, copy the link and open it in a private window and on the iPhone. It should play the spin, name the face, then say "Your turn · flick it". Then Burst on caffeine and **Share clip + link** into Messages.
4. **Remix.** Open the Play tray, tap **Remix ⟳** several times (each look should morph), then **M** and **Shift+M**. In the Remix sheet tick **Show all finishes** and try Holo, Gold leaf and Pearl while turning the molecule.
5. **Ink.** Press **I** on caffeine, then Style → Looks → Sketch. Roll a Remix while inked: the drawing should keep its ink, and a Foil finish should not show until you press **I** again. Copy a replay link while inked and open it: it should open inked.
6. **Ink tiles and Ink-to-Light.** On the home page tap a wall tile (caffeine, benzene, glucose): watch the glow, turn the drawing while it loads, then the hand-off to ink and the light coming on.
7. **`/daily/` on a phone.** Make two or three wrong guesses to see the clues open, then solve it and **Open in 3D**. Paste a `/daily/2026-10-03` link into a chat for the silhouette card, and try `/daily/text`.
8. **Motion: Still, then Gentle,** and repeat steps 1, 3 and 4: sheets and morphs should cut, the replay should open on its last pose, and there should be no Foil sweep.

## Half-done and known limits

> **Update 2026-10-08.**
>
> - **`test:ui` has run.** LUPI CI on `main` ran it green on the wave-3 merge
>   (`66d6220`, 2026-10-03, run 37109926172) and on every merge since, most
>   recently `11d1f4f` on 2026-10-05 (run 37303629773). That includes the
>   edited phone Style assertions in `tests/ui/mobile-scene-controls.spec.ts`
>   and `tests/ui/release-smoke.spec.ts`. The dual-backend smoke, render
>   parity and the export verifiers are local checks; this note records no
>   run of them.
> - **Remix and export.** "Remixed views stay exportable" holds while the
>   Remix sheet's worlds preference is off (the default). With it on, half
>   the codes pick a world (a procedural field or an image), and an opaque
>   artifact export of a world fails closed.

- **Unseen.** No feature in this wave has run in a browser. The first real compile of the ink and Foil shader branches will be on the owner's device.
- **Phone sheets.**
  - Only the handle and title bar drag a sheet; dragging down from scrolled-to-top content does not.
  - The keyboard lift is untested, especially on iOS.
  - A shrunk molecule turns a little faster than the finger.
  - The fit is recalculated only when the overlays, the canvas or the molecule change, never mid-gesture.
  - The command palette and toasts do not make room.
  - Windows that count as phones but are neither narrow upright nor short sideways keep the old full-screen panel.
  - The edited phone Style assertions in `tests/ui` have not been run; CI's `test:ui` is their first check.
- **Overlays.**
  - HTML cards (the desktop atom card, tag annotations, knowledge-label cards) trail by one frame.
  - Not following: atom clusters, ghost atoms, the floor shadow, tapping (it picks rest positions) and camera focus.
  - During trajectory playback, overlays follow from the current frame rather than the in-between positions.
- **Instant Replay.**
  - The clip records in real time with MediaRecorder, so a slow phone can drop frames. The frame-exact encoder from The Shot is not built.
  - The live canvas is briefly resized to 9:16 under the sheet's veil while it records.
  - A replay does not carry trajectory playback, the selection or a hand-tuned look; it carries a Remix code and the ink look.
  - Previews only work for gallery molecules with an `/m` page.
  - Moment thresholds are first guesses.
- **Remix and Foil.**
  - The morph writes the store every frame for 600 ms, which may cost a phone some frames.
  - The softbox reflection steps during a morph.
  - Worlds and moving backdrops switch at the midpoint instead of cross-fading.
  - Not built: Foil on share cards and link previews, feats, and the reduced-motion "one still" reveal.
  - Shake to roll is untested on devices.
  - While ink is on, the pill can still read "✦ Holo foil" although the finish is resting.
- **Daily.**
  - The bloom timing, clue difficulty, warmth feel and phone layout are first guesses.
  - The dev-server routes are untried.
  - `/daily` itself unfurls with the generic card; only date links show the day's silhouette.
  - Not built: bloom videos, the reveal inside the 3D viewer, and the ink-spin clip.
  - Add new molecules only at the end of the queue (`scripts/daily/queue.mts`): reordering changes past days' answers.
- **Ink.**
  - The relay's flat SVG drawing hands over to the toon look in perspective over a 120 ms crossfade, so the shading style changes there.
  - No outline where two balls overlap or a stick enters a ball, and no heavier outer contour (that needs a depth pass, live and in exports).
  - Refractive glass, far-LOD clusters and the billion-atom bricks take no ink.
- **Not run:** the dual-backend smoke, `test:ui`, render parity and the export verifiers (owner's rule). `view.ink` appears in a spec only while ink is on, so lit specs keep their `specId` and the V2 parity candidates need no re-derivation for ink.

## Phone and overlay tuning points

The other features' tables are in their write-ups linked above.

| What | Value | File |
|---|---|---|
| Peek | 25 % of the screen height, kept between 150 and 220 px | `ui/src/panels/usePhoneSheet.ts` |
| Half | 44 %, kept between 240 and 400 px | `usePhoneSheet.ts` |
| Full | reaches the header | `usePhoneSheet.ts` |
| Swipe to close | 55 % of Peek, or a fast flick down | `usePhoneSheet.ts` |
| Smallest molecule | 0.42 of its size; 12 px gap around the free area; at most 45 % shift | `ui/src/camera/viewInset.ts` |
| Play tray wait | 420 ms before the view makes room | `ui/src/play/PlayTray.tsx` |
| Steady labels | 20 % of Heat's jiggle (`STEADY_HEAT`) | `ui/src/play/displayFollow.tsx` |
| Trails | the newest 8 samples bend | `ui/src/AtomTrails.tsx` |
