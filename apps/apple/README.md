# Lupi for iPhone and iPad

The native Lupi app ([plan.md](../../docs/ar/plan.md)): molecules in your room
that you can throw at the walls, stack on the desk and break, drawn and
simulated on the scale spine ([scale.md](../../docs/ar/scale.md),
[scale-spec.md](../../docs/ar/scale-spec.md)). This is M0's slice, the
playable molecules and the scale receipt, and M1's: keeping, the collection,
shelves that remember where trophies sit, and the Lupi account (plan §8).

| Path | What it is | Built and tested |
|---|---|---|
| `Lupi/` | The app: SwiftUI, RealityKit, ARKit, Core Haptics, AVFAudio. It turns frames, touches and collisions into `FrameInput` and applies the `FrameOutput` that comes back | Xcode only |
| `LupiGame/` | The play session: spawning, grab and throw, pinch through the scale axis, breaks, the juice router, the receipt, the HUD; keeping and restoring trophies, the trophy case over LupiSync, shelves and the recovery ladder; and a headless physics stand-in for tests | Linux and Xcode |
| `LupiScale/` | The scale spine: records, references, counts, the cut, frames and proxies | Linux and Xcode |
| `LupiKit/` | Chemistry, bonds, personalities, felt mass, the throw estimator, juice and synthesized sound, the bundled starters, and the `lupi.trophy.v1` and `lupi.shelf.v1` records | Linux and Xcode |
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
  LupiCloud), and LupiScale again in release;
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

- **Tray** (bottom): C₆₀ first, then the starters, the **Scale receipt** menu
  (salt of 10³, 10⁶ and 10⁹ atoms, one at a time or all three in a row) and
  **Clear**.
- **Tap** a molecule to select it and show its plaque; tap it again, or empty
  space, to let go of the selection.
- **Drag** to hold it; **flick** to throw; let go slowly to set it down.
- **Pinch** on a molecule to grow or shrink it through the scale axis, with
  detents; **twist** turns it. A resting molecule grows on its footprint. With
  one finger holding a molecule, a second finger pinches it in your hand.
- The plaque's **Dive in** (on a crystal) grows it about its centre until its
  ions are about 2 cm across, so you stand inside it; **Surface** shrinks it
  back to toy size, 40 cm in front of you.
- **Keep** (on the plaque): the molecule, fragment or crystal becomes a
  trophy in your collection, whatever its size; a billion atoms of salt is
  kept as the same crystal. A kept body shows **Kept**.
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
  (Standard, Gentle, Still; by default it follows Reduce Motion), keeping on
  shelves, and the Lupi account: Sign in with Apple, Sync now, Sign out,
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

## Not in this slice

- Chunks, chips and flight (M3a): the gestures are recognized and refused.
- Terrain collision is simplified: a grown body you stand outside collides as
  its proxy box; from inside, nothing collides with it, and toys are parked.
- Shading parity between instanced atoms and a merged mesh is unconfirmed, so a
  moving body keeps its instances until it rests (scale-spec §9.6).
- Room surfaces are guessed from the impact's direction and height, not looked
  up in the classified LiDAR mesh. The shelf test likewise uses the support
  contact's height above the floor, not the mesh's classification.
- The Collection shows a colour swatch, not the ink drawings from
  `/og/m/<id>-ink.svg` (SwiftUI has no SVG view; M4 polish).
- Building molecules from atoms is M2's. Fragments can already be kept: break
  a molecule and keep a piece.
