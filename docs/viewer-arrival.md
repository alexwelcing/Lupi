# The arrival: a molecule assembling in the viewer

When a molecule opens in the viewer, sixty thousand particles whirl over
the scene in the molecule's own colours, then fly to its atoms from the
bottom up, each taking its element's colour as it lands, and the real atoms
grow in underneath as the particles fade. When one molecule replaces
another, the particles are already sitting on the old atoms and simply fly
to the new ones. About four seconds the first time, three on a switch.

This is the scanner's particle stage (`packages/ui/src/scan/gist`) pointed
at molecules, which is what it was for all along: the same compute kernel,
the same assembly wave, the same shaded discs.

## The pieces

- `packages/core/src/gist/atoms.ts`: `atomsToPoints(frame, count)` turns a
  frame's atoms into coloured points, each atom a shell of points on its
  display sphere with the outward normal, points shared out by surface
  area so a big atom gets more than a small one. Past a few hundred
  thousand atoms there are fewer points than atoms and each point is one
  atom's centre at an even stride. `normalizePoints` centres the cloud and
  scales its longest side to 1.8 units, returning the transform;
  `atomDiscSize` sizes a disc to the atoms it sits on.
- `packages/ui/src/viewer/cameraFeed.ts`: `CameraTap`, mounted in the
  React Three Fiber tree, copies the viewer's camera every frame;
  `cameraInto(centre, scale)` gives the view-projection into the engine's
  normalised space, so particles land exactly where the atoms are drawn.
- `packages/ui/src/viewer/ArrivalStage.tsx`: a second canvas over the
  viewer's, created on the first arrival, kept for the next. It watches the
  store's `file`, builds the points, hands the engine the camera, the disc
  size and the palette, runs the swirl (first time only), calls the
  particles home, then grows the atoms in over a second while the
  particles fade.
- The store's `arrival` (0..1, transient, never saved) multiplies the
  rendered atom scale in `ViewerScene`. `setFile` puts it at 0 when
  arrivals are enabled and the file has atoms; the stage brings it to 1.
  Anything that stops the stage (no WebGPU, reduced motion, a failure, an
  eight-second watchdog, unmount) sets it to 1 at once, so the viewer is
  never left empty. `arrivalEnabled` is off when `navigator.gpu` is absent
  or motion is reduced, and the MCP viewer route turns it off, so an
  agent's export never catches atoms mid-growth. Exports build their own
  scene from the store's atom scale and are not affected either way.

## The room

The effect is only half of it; the other half is how the page brings it
about, on a phone and on a desktop, without crowding and without stalling.

- **The chrome clears.** While the particles whirl and fly, the app root
  carries `data-arriving="true"` and the header slides up, the command deck
  and panels slide out, the bucket and the gesture hint go quiet, exactly
  as stowing does (`apps/web/src/styles/global.css`). It all comes back as
  the atoms land. Nothing unmounts.
- **A veil.** A radial darkening over the viewer (`.lupi-arrival-veil`)
  deepens during the flight and lifts after, so the particles read on a
  light background preset as well as a dark one, and the moment has room.
- **A caption, in three beats.** The molecule's name appears as the whirl
  starts, so the viewer knows what is coming. Its formula, atom count and
  the gallery's one-line subtitle fade in as the atoms land. Half a second
  later, three things to see next: gallery molecules chosen by domain,
  shared elements and similar size (`viewer/related.ts`), as chips; a tap
  opens one, and the particles fly from these atoms to those. The caption
  lets go seven seconds after landing, or the moment the viewer touches the
  scene. Bottom-centred, clear of the bucket on desktop and the deck on
  mobile, higher again above a trajectory's timeline.
- **Ins and outs.** Any touch, wheel or key during the flight lands the
  atoms in a quarter of a second. A load that the particles already sit
  through (the next molecule from the switcher, a chip, a search) lifts
  them off into a whirl while it is in flight, so a network wait reads as
  anticipation; if the load fails they settle back where they were. Reduced
  motion, no WebGPU, the MCP viewer route, an engine failure or an
  eight-second watchdog all show the atoms at once and the chrome never
  moves.

Nothing is pre-made for particular molecules: the name comes from the
gallery entry or the file name, the formula from the atoms, the
suggestions from the local index.

## Seeing it without a browser

```bash
pnpm scan:gist:headless -- --atoms=40
# .verify-artifacts/gist-apple-atoms-{whirl,calling,landed}.png
```

A made-up chain of carbon, nitrogen, oxygen and hydrogen whirls, is
called, and lands as element-coloured shells (2026-09-22: grey, blue, red,
white, forty atoms, sixty thousand points, one in eight hundred
Ångström-per-unit scale, disc 0.008). The browser wiring (camera feed,
store, stage) is typechecked but has only been exercised headlessly from
this container, which has no GPU adapter for Chromium.

## Where it makes sense next

- The scan page's object cloud dissolving into the molecule it opens: the
  same `setHomes` from the object's points to the molecule's, on one
  canvas, instead of the viewer's stage starting from a whirl.
- Trajectory frames: nothing here touches playback; the stage only runs
  when `file` changes.
- The landing page's hero, if a molecule should assemble there too.
