# Wave 3: Remix codes and Foil, status

Short-list item 12: [C062 Remix Codes that Morph](round1-catalog.md#c062) with [Foil Specimens](round2/joy-and-mastery.md#r2-joy-and-mastery-11). Built on `w4/share` (after Instant Replay) under the owner's rule: build, then the owner validates. The only checks were the TypeScript builds of `@atlas/scene` and `@atlas/ui`, lint, and the existing unit tests. **Nothing here has been seen running in a browser.**

## What shipped for a visitor

### Rolling

- **Every Remix has a code.** A roll lands as `r1-K7QDM` and the pill flashes it ("Remix · r1-K7QDM"). The same code makes the same look on any device and on any molecule.
- **Where to roll:**
  - the Play tray's new **Look** row: **Remix ⟳**. The tray stays open, so the next roll is one more tap;
  - **⟳ Again** on the pill for 8 s after a roll (just the icon on a phone);
  - **M** (Shift+M steps back), also inside the tray;
  - the scene deck's **Remix scene**, and the palette ("Remix: roll a new look");
  - **a shake**, on phones that report motion, once the visitor turns it on (see below).
- **It morphs.** A new look arrives in about 600 ms instead of snapping:
  - the lights swing the short way round, and their colours blend in linear light;
  - the material and post strengths dip through the midpoint while their presets switch;
  - a filter shell fades in or out;
  - between two plain gradient backdrops, the backdrop cross-fades.
  - Motion: Still cuts straight to the new look.
- **Back.** Shift+M, the sheet's Undo or the deck's Undo step back through the last eight looks on this molecule, morphing too.
- **Colours stay CPK by default.** "Keep atom colours" starts on. Turned off, each roll also paints a decorative palette, and the code records that.
- **Your look follows you.** Opening another molecule keeps the code on screen, and its Foil.

### Foil

- **About one roll in 24 comes up Foil:** Holo, Gold leaf or Pearl.
  - The pill reads "✦ Holo foil · r1-…".
  - A bright band sweeps across the molecule from the key-light side (about 900 ms) and leaves the finish behind.
  - Sound and haptics, when turned on in Settings, give a three-note chime.
- **Cosmetic, on the rims.** Element colours stay the base of every atom.
  - **Holo** is a thin-film rainbow on the rims that slides as you turn the molecule.
  - **Gold leaf** adds a gold Fresnel rim and a gold key highlight, gilds the bond edges and warms the light a little.
  - **Pearl** is a milky nacre sheen with a faint play of colour.
- **The badge.** While a finish shows, a small foil-bordered chip ("✦ Holo") stays on the pill. It is the "cosmetic finish" label, and it opens the Remix sheet.
- **Published odds.** The tray prints "Foil 1 in 24 · each finish 1 in 72" under Remix, and the sheet repeats it: rolls are free and unlimited, and nothing is counted.
- **Pure function of the code.** A shared Foil code is Foil for whoever opens it. There is no hidden state, pity timer or streak.
- **Two roads.**
  - A finish you roll once stays selectable on that device: Finish → Holo, Gold leaf or Pearl.
  - "Show all finishes" unlocks all three without rolling.
  - "Off" hides a code's finish.
- **Never in an artifact.** Exports, thumbnails, MCP images and ordinary videos never carry a finish. Instant Replay's illustrative clip keeps it, as it keeps the toys, and every frame of that clip says "✦ Holo foil · cosmetic finish".

### The Remix sheet

- **Opening it.** Tap the code chip in the tray, the pill's Foil chip, the code button in the scene deck, or "Remix codes" in the palette.
- **It never hides the molecule.** On desktop it is a card at the right. On a phone it is a short bottom sheet, and the view lifts into the band above it, so you watch every roll morph.
- **What it holds:**
  - **The code.** It wears its finish as its border (a conic rainbow, gold leaf or nacre, sweeping once). It says whether the look on screen is exactly the code, or edited since.
  - **Roll** and **Undo**.
  - **Copy code**, **Copy link** and **Share look**. The link is the molecule's own address plus `?remix=r1-…`.
  - **Type or paste a code.** It takes `r1-K7QDM`, `k7qdm`, `R1 K7QDM` or a whole link. The Apply button says "Apply · Holo" when the typed code carries a foil. A code from a newer version says "That code is from a newer Lupi".
  - **Finish.** From the code, Off, Holo, Gold leaf or Pearl, with ✓ on the ones found on this device.
  - **Preferences:** Keep atom colours, Worlds & moving backdrops, Show all finishes, and Shake to roll (touch devices only).

### Shake to roll

- **Off until the visitor switches it on** in the Remix sheet.
- **Permission.** On iOS the switch's tap asks for motion permission. On a later visit the first tap anywhere re-arms it. If permission is refused, the switch reads "Not allowed in this browser".
- **What counts as a shake:** three jolts over 13 m/s² within 0.9 s (gravity removed), then a 1.2 s rest. A bump or a walk does not roll. Motion is ignored while a text field has focus or the tab is hidden.

### Links and paste

- **`?remix=r1-…` links.** The look lands as the molecule opens (the arrival is the motion), and the pill reads "Shared look · r1-…". The parameter then leaves the address bar.
- **Replay links carry the look.** An Instant Replay link carries the sender's code while the look on screen is exactly that code, so the friend watches it in the sender's look.
- **Paste anywhere.** Pasting an `r1-` code or a `remix=` link anywhere on the viewer outside a text field applies it.

### Looks morph too

The deck's four Looks (Studio, Paper, Night, Prism) morph the same way. Choosing one retires the code on screen, and its Foil with it.

## How it works

| Piece | File |
|---|---|
| Codec, the frozen r1 catalog, Foil rarity, parsing | `packages/ui/src/remix/code.ts` |
| Remix as codes (the old `remixScene` API kept) | `packages/ui/src/sceneRemix.ts` |
| Roll, apply, undo, code status, history | `remix/actions.ts` |
| Code on screen, chosen finish, found finishes, preferences | `remix/remixStore.ts` |
| The 600 ms morph | `remix/lookMorph.ts` |
| The gradient backdrop cross-fade (a dome sampled like `scene.background`) | `remix/RemixBackdropFade.tsx` |
| Softbox re-bake paced during a morph (at most every 200 ms) | `SceneLighting.tsx` |
| Foil shading (atoms and bonds), the sweep, capture and recording guards | `packages/scene/src/tsl/atomFoil.ts`, `tsl/atomImpostorMaterial.ts`, `tsl/bondImpostorMaterial.ts` |
| Foil uniforms from the store: the sweep, the fade | `remix/FoilDriver.tsx` (job `lupi/atom-foil`) |
| Links, paste, codes across molecules, `__lupiPlay.remix()` | `remix/links.ts`, `remix/RemixDriver.tsx` |
| The sheet | `remix/RemixSheet.tsx`, `remix/remixSheet.css` |
| Shake detection and permission | `remix/shake.ts` |
| Tray Look row, pill Again and Foil chip | `play/PlayTray.tsx`, `play/PlayPill.tsx`, `play/playPill.css` |
| The Foil label on Replay clip frames | `replay/clipCompositor.ts`, `replay/ReplaySheet.tsx` |
| The phone sheet's view lift (a bottom occluder) | `camera/viewInset.ts`, `camera/ViewInsetDriver.tsx` |
| M / Shift+M, palette rows, deck | `app/useGlobalShortcuts.ts`, `ViewerApp.tsx`, `StudioControlDeck.tsx` |

### The code

`r1-` plus five Crockford base32 characters (case-insensitive; I and L read as 1, O as 0), 25 bits:

| Bits | Meaning |
|---|---|
| 24 | `colors`: the code paints a decorative palette (off: atom colours untouched) |
| 23 | `worlds`: the backdrop may be a world or a moving field |
| 0–22 | seed of a mulberry32 stream (after a murmur3 finalizer) |

The resolver reads nothing from the viewer: not the current look, not the atom count, not the device. Every draw happens whatever the flags say, so toggling a flag on the same seed changes only the backdrop or the palette. The roll steps the seed until the backdrop and recipe (and the palette, when it paints one) differ from the current look, so a roll always reads as new while the code stays a pure function. Integer arithmetic and correctly rounded doubles keep it bit-identical in every browser. A throwaway check over 57,000 codes gave Foil 1 in 23.96 and a clean parse round trip.

**The r1 catalog** is frozen in `code.ts`. It holds:

- 12 unadjusted gradient backdrops;
- 16 worlds and moving fields;
- 9 material recipes, with transmission excluded;
- 8 designed fill and rim light pairs;
- ranges for strengths, angles and surface offsets;
- the shell odds (mostly off);
- 10 palettes.

Any change to the catalog is r2, and r1 keeps resolving. If a catalog id ever leaves `BG_PRESETS`, its backdrop falls back to Void.

## Decisions and departures

- **A versioned catalog, not the resolved look.** K09 asked for the resolved look or a versioned catalog id. A five-character code can't hold 40 fields, so the code names a look in a frozen, versioned catalog. Nothing outside the code (state, flags, atom count) changes what it resolves to.
- **Keep atom colours defaults on.** Before, the deck's Remix repainted the atoms by default. The owner's CPK rule wins: the palette is opt-in, and the code records it.
- **Remix looks stay exportable.** r1 never adjusts a gradient's brightness, saturation, contrast or yaw (deterministic export fails closed on those) and never picks transmission.
- **Foil is not in exports.** The write-up says finishes are never part of deterministic export or MCP artifacts. The capture guard cannot tell an interactive PNG from an artifact, so no raster capture carries a finish. The sheet says so.
- **No feats system.** "Earned by a feat" becomes "a finish you roll once stays yours on this device", plus "Show all finishes" for anyone who doesn't want to play.
- **The look follows the visitor to the next molecule.** Before, each molecule opened in its own editorial look. With a code on screen it now opens in that code's look.
- **The morph tweens the store, not a uniform bus.** The look lives in store keys that many components turn into uniforms, so the morph writes them once per animation frame. No component changed for it, except the softbox, which now re-bakes at most every 200 ms during a morph.

## Tuning points (first guesses)

| What | Value | Where |
|---|---|---|
| Morph | 600 ms, cubic in-out; material dip to 0.06, post dip to 0.3; shell through 0.001 | `remix/lookMorph.ts` |
| Softbox re-bake during a morph | at most every 200 ms | `SceneLighting.tsx` |
| Foil odds | 1 in 24, finish from the next digits | `remix/code.ts` |
| Foil sweep | 900 ms, band half-width 0.16 of the molecule, glint 0.7; fade out 300 ms | `remix/FoilDriver.tsx`, `tsl/atomFoil.ts` |
| Holo | rim 0.95 (power 1.8), sheen 0.1, hue travel 1.6 | `ATOM_FOIL_TUNING` |
| Gold leaf | rim 1.15 (power 3; bonds ×1.25), highlight 0.85 at shininess 70, warmth 0.07 | `ATOM_FOIL_TUNING` |
| Pearl | lift 0.16, sheen 0.32, play of colour 0.24 | `ATOM_FOIL_TUNING` |
| Far atoms | finish fades to 35 % under about 5 px radius | `ATOM_FOIL_TUNING.lodPixels` |
| Shake | 3 jolts over 13 m/s² in 0.9 s; 90 ms between jolts; 1.2 s rest | `remix/shake.ts` |
| Pill "Again" | 8 s after a roll | `play/PlayPill.tsx` |

## Half-done and known limits

- **Unseen on a device.**
  - The finishes have not been looked at, and the Holo hue and the Gold and Pearl strengths need an art director's eye.
  - The sweep direction from the key light and the cross-fade dome's match with `scene.background` are untested.
- **The morph writes the store every frame for 600 ms.** That re-renders the viewer scene each frame, which may cost a phone some frames.
- **The softbox catchlight steps.** During a morph it moves in up to three steps (one re-bake every 200 ms) while the direct lights swing smoothly.
- **Rolling faster than 600 ms.** A new roll starts from wherever the last one stands. Between gradients the backdrop fade can jump once.
- **Backdrops that only switch.** Worlds, moving fields and adjusted backdrops change at the midpoint instead of cross-fading. Palettes and the atom texture also switch at the midpoint.
- **Not built:**
  - the filter-shell "case" for a finish;
  - feats;
  - Foil on share cards and link previews (only the Replay clip's frames are labelled);
  - the reduced-motion "one still" reveal (Still simply shows the finish at once).
- **A link carries the code, not edits.** A code tweaked after rolling ("edited") is not put in replay links, and Share look shares the code as rolled.
- **Shake to roll is untested on iOS and Android.** The thresholds are guesses.
- **Desktop has no view shift for the sheet.** The card at the right can cover part of a wide molecule.

## Try first

1. **C60 on desktop.** Open the Play tray and tap **Remix ⟳** a few times. Each look should morph, not snap, and the code should change under your finger. Then press **M** a few times, and **Shift+M** to go back.
2. **Foil.** Open the tray's code chip and tick **Show all finishes**. Try **Holo**, **Gold leaf** and **Pearl** on caffeine, turning the molecule each time: the Holo rim should slide as it turns. Then export a PNG: no finish.
3. **Share.** Copy a code from the sheet, open a private window on another molecule, and paste it anywhere on the viewer. The look should land. Then open **Copy link** on your phone.
4. **Phone.** Open the sheet, switch on **Shake to roll** (iOS asks), and shake. With the sheet open, the molecule should sit above it.
5. **Still.** Settings → Motion: Still. A roll should cut, and a Foil should appear with no sweep.
