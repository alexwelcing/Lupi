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
