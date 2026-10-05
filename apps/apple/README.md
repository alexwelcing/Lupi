# Lupi for iPhone and iPad

The native Lupi app ([plan.md](../../docs/ar/plan.md)): molecules in your room
that you can throw at the walls, stack on the desk and break, drawn and
simulated on the scale spine ([scale.md](../../docs/ar/scale.md),
[scale-spec.md](../../docs/ar/scale-spec.md)). This is M0's slice, the
playable molecules and the scale receipt; M1's keeping, the collection,
shelves that remember where trophies sit, and the Lupi account; M2's
building from atoms, with fragments and built molecules you keep; and M3a's
scale: the salt ladder to a googolplex, copper, diamond and the diamondoids,
monuments and terrain, flight along the scale axis, chunks and chips, and the
spikes S8 and S9 (plan §8).

| Path | What it is | Built and tested |
|---|---|---|
| `Lupi/` | The app: SwiftUI, RealityKit, ARKit, Core Haptics, AVFAudio. It turns frames, touches and collisions into `FrameInput` and applies the `FrameOutput` that comes back | Xcode only |
| `LupiGame/` | The play session: spawning, grab and throw, pinch through the scale axis, breaks, the juice router, the receipt, the HUD; the atom tray, the snap magnet, hydrogen fill and "Built it"; keeping and restoring trophies, the trophy case over LupiSync, shelves and the recovery ladder; the scale content, flight, Life size, Grow ×2, chunks and chips, and terrain colliders; and a headless physics stand-in for tests | Linux and Xcode |
| `LupiScale/` | The scale spine: records, references, counts, the cut, frames and proxies | Linux and Xcode |
| `LupiKit/` | Chemistry, bonds, building (snap geometry and its re-perception check, hydrogen fill, naming graphs), personalities, felt mass, the throw estimator, juice and synthesized sound, the bundled starters and known molecules, and the `lupi.trophy.v1` and `lupi.shelf.v1` records | Linux and Xcode |
| `LupiCloud/` | The account and its sync: Firebase Auth and Firestore over REST | Linux and Xcode |
| `project.yml` | The XcodeGen spec: the source of truth for the Xcode project, Info.plist and the entitlements | |
| `Config/` | `Lupi.xcconfig` (committed) and your `Secrets.xcconfig` (ignored by git): the account's configuration | |

## Build and run on a Mac

You need Xcode with the iOS 26 SDK or later, and XcodeGen.

```bash
brew install xcodegen
cd apps/apple && xcodegen generate && open Lupi.xcodeproj
```

1. In Xcode, pick the **Lupi** scheme.
2. Under Signing & Capabilities the team is **26Y4SLFJ4M** with automatic
   signing (set in `project.yml`). If Xcode shows "None", pick that team. The
   bundle id is `live.lupi.app`.
3. Connect an **iPhone 15 Pro** or an **iPad Pro** (both have LiDAR), choose it
   as the run destination and press Run. The Simulator has no AR camera, and
   the app requires ARKit (`UIRequiredDeviceCapabilities: arkit`). LiDAR is not
   required: without it the molecules land on the floors and tables ARKit
   detects.
4. On first launch the app asks for the camera. In Play, move the device slowly
   until ARKit's coaching overlay goes away. Anything you spawn before that
   waits for tracking.

`Lupi.xcodeproj`, `Lupi/Info.plist` and `Lupi/Lupi.entitlements` are generated
and ignored by git. Run `xcodegen generate` again after pulling changes or
adding files.

## The account's configuration

The app runs without it: everything, keeping and shelves included, works on
the device, and Settings says the account is not configured. To turn the Lupi
account on (D7):

1. Do the owner checklist in
   [account-and-sync.md §7](../../docs/ar/account-and-sync.md#7-owner-checklist):
   Sign in with Apple on the App ID, the key and Services ID, the Apple
   provider in Firebase Auth with its OAuth code flow fields (token
   revocation fails without them), the bundle id in the Apple provider's
   audience list, the Firestore rules and the `deleteUserData` function.
2. Create the API key of step 7 there: application restriction *iOS apps*,
   `live.lupi.app`; API restrictions *Identity Toolkit API* and *Token Service
   API*. Do not reuse the web key.
3. Copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig` and put
   the key and the project id in it:
   ```
   LUPI_FIREBASE_API_KEY = AIza…
   LUPI_FIREBASE_PROJECT_ID = shed-489901
   ```
   git ignores `Secrets.xcconfig`; never commit a key. `Config/Lupi.xcconfig`
   includes it when it exists (`#include?`), `project.yml` fills the Info.plist
   keys `LupiFirebaseAPIKey` and `LupiFirebaseProjectID` from it, and the app
   reads them at launch.
4. `xcodegen generate` again. The generated entitlements carry
   `com.apple.developer.applesignin = [Default]`; with automatic signing Xcode
   adds the capability to the provisioning profile. If Signing & Capabilities
   shows an error for Sign in with Apple, enable it on the App ID first (step 1).

## What CI covers

The Apple workflow (`.github/workflows/apple.yml`) runs on Linux:

- `swift test` for every package here (LupiKit, LupiScale, LupiGame,
  LupiCloud), and LupiScale again in release (run LupiGame's in release
  yourself with `swift test -c release`: its directive tests time frames);
- `tools/apple/parse-app.sh`, which runs `swiftc -parse` over every Swift file
  in `Lupi/`. It catches syntax errors only: Linux has no SwiftUI, RealityKit
  or ARKit, so it cannot type-check, link or sign the app;
- `pnpm apple:check`: the Swift sources generated from the web's TypeScript
  are current.

So the first full compile of the app happens on your Mac, and nothing here has
run on a device until you run it.

## Pasting compile errors back

Copy the error lines with their file and line. From Terminal:

```bash
cd apps/apple
xcodebuild -project Lupi.xcodeproj -scheme Lupi -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates build 2>&1 | grep -E 'error:|warning:' | head -100
```

or in Xcode open the Report navigator (⌘9), select the failed build, and copy
the errors. Errors inside the packages should not happen, since Linux CI
compiles and tests them; say so if one does.

## Playing

- **Tray** (bottom): **Atoms**, then C₆₀, the starters, the **Scale receipt**
  menu (salt of 10³, 10⁶ and 10⁹ atoms, one at a time or all three in a row),
  the **Scale** menu and **Clear**.
- **Scale** (M3a): the salt ladder (10³, 10⁶, 10⁹, 10³⁰, a googol and a
  googolplex atoms; the last two are bars of 30 × 3 × 3 cm, the rest 15 cm
  cubes), copper's billion (open, and closed with its outer faces complete),
  one carat of diamond, and the diamondoids from adamantane to C₂₉₂₅H₆₇₆.
  Every count is exact, and a kept one is a few hundred bytes. Home lists the
  salt ladder too.
- **Atoms** opens the atom tray: H, C, N, O, F, P, S, Cl, Br, I and Na as CPK
  beads, plus any element a break has freed (it is new for this session
  only). Tap one to drop a 3 cm atom ahead; successive atoms land 10 cm apart.
- **Building** (plan §4.5). Pick an atom up and carry it to another: inside
  about 1.6 bond lengths the magnet takes hold, the smaller piece glides in
  (and to the larger one's size), and within a bond length it clicks into
  place at the ideal angle. Loose atoms, the pieces of a break and anything
  built snap; a molecule spawned whole only takes them. Nothing snaps by
  itself: one of the two must be in your hand, or thrown and still moving,
  so a throw of a hydrogen at a broken hydroxyl joins them, and the halves
  of a break never rejoin unless you bring them together. If the bond would
  not read back as the bond you made (a crowded spot), it bounces off with a
  dull bump. You keep holding what you built. On the plaque, **Fill H** fills
  every open valence with hydrogens. When every atom has its usual partners,
  or Lupi knows the molecule, it celebrates: "You built ethanol". The pieces
  of a bond break are named honestly: "HO radical", "Hydrogen atom", or a
  molecule's own name when a whole one falls out.
- **Tap** a molecule to select it and show its plaque; tap it again, or empty
  space, to let go of the selection.
- **Drag** to hold it; **flick** to throw; let go slowly to set it down.
- **Pinch** on a molecule to grow or shrink it through the scale axis, with
  detents; **twist** turns it. A resting molecule grows on its footprint. With
  one finger holding a molecule, a second finger pinches it in your hand.
- The plaque's **Dive in** (on a crystal) grows it about its centre until its
  ions are about 2 cm across, so you stand inside it; **Surface** shrinks it
  back to toy size, 40 cm in front of you. Beyond 10³² times life size (the
  googolplex on the desk) it reads **Fly in**: the picture zooms toward the
  surface under the screen's centre while whole periods of the lattice pass
  unseen, about 20 s from the desk to 2 cm ions, and the plaque counts the
  magnification as it goes. Gentle flies at half speed; Still cuts in jumps.
- **Two fingers held still**, with a body beyond 10³² selected (or terrain
  around you), fly toward it; lift them and the picture finishes its way. A **pinch** on a
  body anchored deep inside its lattice moves along the scale instead of
  stretching the picture.
- **Inside a crystal** (dived in, or walked into a monument), the atoms within
  35 cm are cleared around you, a banner says so, and every toy waits, frozen,
  until you step out. Outside, a crystal grown past 3 m is terrain: toys land
  on its faces and roll over its atoms, not on the floor under it.
- **Life size** (on the plaque, when it fits the room): the body glides to
  its true size on the floor ahead, its near face 1.2 m away. The 10³⁰ cube is
  2.82 m tall and weighs 48.6 t. The plaque prints every body's true mass
  beside how heavy it feels as a toy.
- **Chunks and chips** (M3a). Drag one finger across a monument or terrain:
  a piece 4 to 40 cm across comes away in your hand ("Chunk of …"). Hold
  still 400 ms first and it is a chip of 1 to 5 cm. The counts add up
  exactly: a chunk of the googolplex's 1 cm ions leaves 10^(10^100) − 1,000.
- **Grow ×2** (off by default; Settings, Scale): the plaque's **Grow ×2**
  doubles a molecule along one side, keeping its size in your hand. A water
  tapped a hundred times holds 3 × 2¹⁰⁰ atoms and still keeps in a few
  hundred bytes.
- **Keep** (on the plaque): the molecule, fragment, built molecule or
  crystal becomes a trophy in your collection, whatever its size; a billion
  atoms of salt is kept as the same crystal. Fragments and built molecules
  keep their atoms (embedded XYZ) and their story: "Broken from Hydrogen
  peroxide", "Built from atoms: O, H, H". A kept body shows **Kept**.
- **Shelves.** A molecule that sits still for three seconds on a surface at
  least 25 cm above the floor (a shelf, a desk, a table) is kept there with the
  kept chime, and stays there for next time. The first one in
  a room makes the room's shelf. The floor is the lowest horizontal plane ARKit
  has found, a classified floor when there is one; until it has seen your
  floor, nothing counts as a shelf. Turn this off in Settings with **Keep what
  rests on a shelf**.
- **Next time** Play opens the room used last and looks for it: the shelf's
  trophies wait while ARKit relocalizes, with the room's photo as a small card
  ("Look at your shelf"). When it matches, they appear where you left them.
  After 20 s without a match the card offers **Put the shelf here** (tap a
  surface and the whole arrangement moves there) and **New room**. The
  coaching overlay's Start Over does the same instead of resetting the session.
- **Collection** (the stack button at the top of Play, or Home): every trophy,
  with its count and its story. Tap one to bring it into play; swipe to rename
  or delete. **Rooms** lists the rooms on this device; swipe to delete one or
  choose which opens next.
- **Settings** (gear): Sound & haptics (on by default), Motion comfort
  (Standard, Gentle, Still; by default it follows Reduce Motion), Grow ×2,
  keeping on shelves, and the Lupi account: Sign in with Apple, Sync now, Sign out,
  Delete account (it asks you to sign in with Apple once more, which is what
  lets it revoke Lupi's Apple tokens), and Erase this device's collection.

## The debug HUD

Touch and hold the **Lupi** badge at the top of the play screen. Its lines:

| Line | Meaning |
|---|---|
| `fps, worst, cut` | Frames per second over the last second, the slowest frame interval in it (ms), and this frame's `buildCut` time (ms) |
| `bodies, toys, items, visited` | Bodies in play, toys counted against the 40-toy budget, the cut's draw items and visited nodes; `OVER BUDGET` when the cut hit a budget |
| `atoms` | The exact total of every body's atoms (`Magnitude.formatted`) |
| `drawn, instanced, τ` | Atoms the cut drew, atom instances RealityKit drew this frame, and τ, the screen-space error in pixels |
| `thermal, tracking, map` | `ProcessInfo` thermal state, ARKit tracking state, world-mapping status, and whether the device has LiDAR |
| `last impulse, Δv` | The last contact's impulse (N·s) and the Δv the juice used (m/s) |
| `last throw` | Release speed of the last throw (m/s) |
| `last mesh` | The last merged mesh: atoms and build time (ms) |
| `magnet` | While a snap is pulling: host ← guest, the atoms' distance, the magnet zone and the distance it snaps at |
| `flight` | During a flight: its kind, φ now and its target, the frames that wrapped and the periods wrapped in all (exact), and the anchor path's steps |
| `S8 terrain` | While there is terrain: face boxes, the camera window's shapes, body windows and their shapes, and window rebuilds in the last second |
| `S8 app` | How the app built the last window (spheres or static mesh): the time from the command to the colliders being set, the mean and worst of the last 30, builds in flight, stale and failed |
| `S9 …` | One line per body of the S9 drop: when it landed and rested, how deep it sank, its jitter, and whether it fell through or was lost |

The spike controls follow, then their results and the contact log.

## Device spikes (plan §8 M0)

Record what each shows on the iPhone 15 Pro and the iPad Pro.

- **A1, world map.** Leave a molecule on a shelf until it is kept, look
  around until the HUD's map reads `extending` or `mapped`, and the map saves
  itself 5 s after the last pin (or tap **A1 save shelf map**). The `A1` lines
  log each step: `saved` with the size, time and anchors; after **A1
  relocalize** (the session runs again from the saved map with
  `resetTracking` and `removeExistingAnchors`, and everything in play poofs),
  `tracking relocalizing`, then `tracking normal after N s`, then `root anchor
  after N s, K frames drawn while relocalizing`, then any `root drift`. The
  real test is the M1 exit below: force-quit and open Play the next day. Tap
  **A1 copy log** and paste the JSON lines back. Record: does RealityView keep
  drawing the camera while relocalizing (K > 0), how long the match takes, how
  far the root drifts, and whether the trophies sit where you left them. The
  `ARView` comparison the plan mentions is not built.
- **A2, slow-motion clock.** Turn on **A2 custom simulation + clock**: the play
  root gets its own `PhysicsSimulationComponent` (solver 12/4) with a
  `CMTimebase` clock. Throw a molecule at a LiDAR wall: does it bounce, or pass
  through? Tap **A2 quarter speed for 2 s** and throw again: does it slow down,
  and still hit the wall? Without A2 the app never slows time; hit-stop alone
  carries big moments.
- **A3, tumble.** Spawn caffeine, let it rest, tap it to select it, then tap
  **A3 toss the selected body**: it flies up at 4 m/s spinning 20 rad/s about
  its intermediate axis. The HUD's A3 line counts flips of that axis before it
  lands. Flips mean RealityKit keeps the gyroscopic terms; none in five tosses
  means it does not (plan §4.2).
- **A4, first-contact impulse.** Turn on **A4 log contact impulses** and throw
  at a wall. `B` lines are `CollisionEvents.Began` with the impulse (N·s) and,
  for comparison, the body's momentum just before (m·v; a bounce takes up to
  twice that). `U` lines are the `Updated` reports of the next 50 ms. Record
  whether `Began` alone reads near the largest.
- **S7, instanced spheres.** Pick **5k**, **10k** or **30k**: a static cube of
  instanced spheres in four element colours appears 50 cm ahead. Record fps and
  the worst frame at each, and the thermal state after two minutes. Whether a
  `CustomMaterial` can read an instance index needs a Metal shader and is not
  built here.
- **S10, merged meshes.** Tap **S10 time 1k and 2k atom meshes**: it reports
  the geometry time off the main actor and the `MeshResource` time on it.

### M3a spikes (plan §8 M3a)

- **S8, terrain window rebuild latency.** Spawn the googolplex, tap it, **Fly
  in**, and stand on the plain of salt. The `S8 terrain` line shows the face
  boxes and the camera's window of atom bumps (at most 64 spheres in 1 m,
  rebuilt when you move 25 cm); drop a molecule and it gets its own window
  when it slows down. Turn on **S8 rebuild the camera window every frame** and
  walk: the `S8 app` line's mean and worst are the cost of a rebuild. Then
  pick **S8 static mesh**: each window becomes one triangle mesh made by the
  asynchronous `ShapeResource.generateStaticMesh`, and the line measures the
  time until it is in place, with stale builds that a newer one overtook.
  Record both modes' mean and worst, the fps, and whether a molecule resting
  on the atoms ever drops through while its window is rebuilt.
- **S9, colliders at the size extremes.** Tap **S9 drop boxes and hulls of 3
  and 90 cm**: a 3 cm box, a 90 cm bar (the googolplex grown 3×), a 3 cm hull
  of a molecule and a 90 cm one fall side by side 1.5 m ahead. The `S9` lines
  say when each landed and rested, how far it sank into the floor and how much
  it jittered at rest. Record them on a LiDAR floor and on a table. The
  stand-in physics in the tests says nothing about RealityKit here.

Two assumptions to check while you play: a spawned molecule appears about
40 cm ahead of the camera, centred, and a tap selects the molecule under your
finger in both orientations. If either is off, the RealityView world origin or
the camera projection differs from ARKit's, and the HUD's tracking line plus
the device and orientation are what to send back.

## The M1 exit (plan §8 M1)

1. The M0 scale receipt still holds.
2. Leave three molecules on a real shelf until each is kept. Force-quit, open
   Play the next day: they are there, or one tap on **Put the shelf here**
   brings them.
3. Keep a salt crystal of a billion atoms (Scale receipt, then Keep). It comes
   back from the Collection as the same crystal: the plaque prints
   1,000,000,000 atoms and the same formula.
4. Sign in on the iPhone, then on the iPad: the collection is there.
5. Delete the account in the app (Settings, Delete account).

If anything in the account fails, Settings shows the error line; send it back
with the Firebase console's Authentication log entry if there is one.

## The M2 exit (plan §8 M2)

1. Open **Atoms**; drop an O and two H. Carry the O to one H, then on to the
   other: two clicks, the lime ring and "You built water".
2. Drop two C and an O. Carry the first C to the second, then the pair to
   the O; tap the result, then **Fill H**: "You built ethanol".
3. Leave both on a real shelf until kept (or tap **Keep**).
4. Throw hydrogen peroxide at a wall; tap a hydroxyl and **Keep** it.
5. Force-quit and open the **Collection**: the three come back with the same
   bonds (water's two O–H, ethanol's C–C–O, the hydroxyl's O–H), and their
   stories read "Built from atoms: O, H, H", "Built from atoms: C, C, O, H, H,
   H, H, H, H" and "Broken from Hydrogen peroxide".

Report how the magnet feels: the 1.6× zone, the glide and the pull on a held
atom are the starting values in `BuildTuning` (LupiGame) and `Snapper`
(LupiKit).

## The M3a exit (plan §8 M3a)

1. **Scale**, Salt, a googolplex atoms: a bar on the desk reading
   10^(10^100) atoms. Throw it at a wall: ten cubes of 10^(10^100 − 1) each.
2. Spawn another, tap it, **Fly in**: about 20 s to ions 2 cm across, the
   plaque counting the magnification. Walk on the plain; drop caffeine on it.
   Step down into the salt: the toys wait, the banner shows; step out.
3. Drag a finger across the plain: a chunk of 1,000 ions comes away in your
   hand, and the plaque of the rest reads 10^(10^100) − 1,000.
4. **Surface**: the bar comes back to the desk.
5. **Scale**, Salt, 10³⁰ atoms, then **Life size**: a 2.82 m cube of 48.6 t on
   the floor, 1.2 m ahead. Walk around it.
6. Copper, a billion atoms: pinch it up to about 2 m (a monument), step back,
   and take a chunk and a chip.
7. Run S8 and S9 above and send the HUD lines back.

## Not in this slice

- Terrain colliders follow scale-spec §10.1's numbers (0.5 m face boxes, 64
  bumps in the camera's 1 m, 256 in all), unproven on a device until S8 runs.
- Stepping into a monument (the life-size cube, a crystal pinched to 2 m)
  shows the room: the excavation bubble opens only inside terrain, over 3 m
  (scale-spec §10.1), and a monument around the camera draws nothing.
- Chunks and chips need the monument or terrain in front of you, not around
  you, and are refused while you stand inside a solid or during a flight.
- Shading parity between instanced atoms and a merged mesh is unconfirmed, so a
  moving body keeps its instances until it rests (scale-spec §9.6).
- Room surfaces are guessed from the impact's direction and height, not looked
  up in the classified LiDAR mesh. The shelf test likewise uses the support
  contact's height above the floor, not the mesh's classification.
- The Collection shows a colour swatch, not the ink drawings from
  `/og/m/<id>-ink.svg` (SwiftUI has no SVG view; M4 polish).
- A new bond does not grow on the `click` token: the merged molecule clicks
  with a squash along the new bond, and its merged mesh follows a frame or
  more later (instanced atoms until then, scale-spec §9.6).
- Snaps make single bonds only, so a built molecule's double bonds come from
  the pieces it was built from (a hydroxyl's O–H, a vinyl's C=C).
