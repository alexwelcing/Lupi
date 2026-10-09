# LupiGame

The play session behind the native Lupi app: everything in M0's playable slice
and scale receipt, M1's keeping and shelves, M2's building, M3a's scale play
and M4's polish that needs no Apple framework (plan §3–§8; scale-spec §7–§10). The app in `apps/apple/Lupi` only turns RealityKit, ARKit
and SwiftUI events into `FrameInput` and applies the `FrameOutput` that comes
back. Foundation only, Swift 6 language mode, iOS 26 and macOS 26, so it builds
and tests on Linux CI as well as in Xcode.

| Target | What it holds |
|---|---|
| `LupiGame` | `PlaySession`: bodies as LupiScale `BodyFrame`s over scale references; the spawn queue (one a frame) and pop-in; the gesture arbiter of scale-spec §10.5; grab, hold and throw on LupiKit's `HoldFollow` and `ThrowEstimator`; pinch and twist through the anchor and the scale axis (§8.8) with size states (§10.1); breaks from LupiScale's `BreakPlan` with each piece's velocity at its centre plus 0.4 m/s outward, inset proxies, cooldowns and growth to 6 cm (§10.6); the juice router from contacts to LupiKit's `JuiceDirector` (the 50 ms impact window, Δv from felt or reduced mass, the surface hit); rest damping, out-of-bounds rescue and the 40-toy budget; terrain with parked toys; the cut every frame with the τ controller; the scale receipt (salt of 10³, 10⁶ and 10⁹ atoms) and its dive to 2 cm ions; the HUD with exact totals (`Magnitude.formatted`); merged-mesh geometry for molecules (`MeshBuilder`); camera rays from ARKit's projection; building (M2): the atom tray, the magnet (the smaller body glides on `glide` to the larger one's atom and toy scale, or the hand is pulled when it holds the smaller), snaps through LupiKit's `Snapper` into a new leaf in the larger body's frame, refusals that bounce, hydrogen fill, "Built it" named from `KnownMolecules`, and built trophies; scale play (M3a): the scale content from the bundled pack `lupi-scale-r1.lpk` (`ScaleContent`: the salt ladder from 10³ to a googolplex, copper's billion as one crystal record, open and closed, a one-carat diamond, the {111} diamondoids of orders 1 to 12, and true masses as `MassText`), flight along the scale axis (dive, surface, a two-finger hold and a pinch beyond 10^±32, Gentle at half speed and Still as cuts, wraps by whole periods counted exactly), Life size, Grow ×2 behind `GameSettings.growTwo`, chunks and chips that come away already in the hand, terrain physics (face planes as 0.5 m boxes and windows of atom bumps around the camera and slow bodies, sent as `PhysicsCommand.staticColliders`; colliders off and toys parked while the camera is inside a solid), and the spikes S8 (`SessionDebug.s8RebuildEveryFrame`, `TerrainStats.line`) and S9 (`s9DropExtremes`, `S9Probe`); polish (M4): the flop's segment recipes (`segmentRecipes(for:)`, `MeshRecipe.segment(_:of:)` with stubs at the hinges) and their poses in `RenderState.segments`, the cage ring on the squash, each body's `Timbre` in the juice, plaques with every reason and the feel, `BodyAccessibility` for VoiceOver with spoken counts and formulas and `toss(_:)`, the thermal policy (`ThermalPolicy`, `ThermalStage`, `FrameOutput.frameRate`, `SessionDebug.a5ThirtyFPS` and `thermalOverride`), and the first-run card (`Onboarding`, `OnboardingCard`) |
| `LupiGameSim` | `StubWorld`, a deterministic stand-in for RealityKit's physics (gravity, damping, impulses, a desk and walls, bodies against each other, sleeping, static colliders as plane, box-top and sphere obstacles, `CollisionEvents`-like reports), and `Simulation`, which steps a session against it with scripted touches |

## Build and test

```bash
cd apps/apple/LupiGame
swift build
swift test                 # debug
swift test -c release      # the directive's timings again, optimized
```

| Suite | Covers |
|---|---|
| catalog and the scale receipt | C₆₀ first in the tray; starters copied from the gallery are scale-spec §12.2's leaves; the receipt rungs are §12.4's towers with exact counts and 229-byte references; exact HUD totals |
| play session | spawn, float, land and settle (once); a flick at the wall with its juice; a set-down; hydrogen peroxide cracking into two hydroxyls with exact identities; pieces' inherited velocity and 0.4 m/s kick; the 10⁹ crystal smashing into ten pieces that share its felt mass; Sound & haptics off, Still comfort, iPad without haptics; the 40-toy budget; out-of-bounds rescue; every frame of the receipt within its budgets, cool and critical; requests between frames; determinism |
| scale in play | pinch on the footprint, one to one within 10^±32, mass unchanged; toy, monument and back; the dive into the 10⁹ crystal (terrain, parked toys, the bubble's wall within budgets, exact counts) and back out; the receipt within the critical column |
| gesture arbiter | recorded touch streams: tap, grab by move and by hold, pinch with and without a held body, twist, fly only beyond 10^±32, chunk and chip |
| scale content | the bundled pack is scale-spec §12.6's, root for root; the ladder's §12.4 NodeIDs and exact counts; copper as one record of 1,000,188,000 atoms (1,002,571,291 closed); the diamondoids against §3.3.4; a carat weighs 0.2 g (to half a microgram) in a cube 3.85 mm on a side; true masses ("48.6 t" for the 10³⁰ cube); every item spawning at its size |
| flight | the googolplex dive to 2 cm ions in about 21 s at 30 fps, every frame within budgets, the anchor path one merged step; surfacing back to the desk; a two-finger hold that flies the googolplex and not caffeine; Gentle at half speed; Still as cuts at most every 0.35 s; a pinch on deep terrain moving φ |
| scale play | the 10³⁰ cube at life size, 2.82 m and 48.6 t on the floor ahead, and the refusals with their sizes; Grow ×2 off by default, then a water grown a hundred times into §12.4's records, 3 × 2^100 atoms that keep and come back; a chunk and a chip from copper's billion with counts that add up; the googolplex's grain of 1,000 ions leaving 10^(10^100) − 1,000 |
| terrain | a plain of salt holding a caffeine on its face, not the desk under it; windows of at most 64 and 256 shapes; fast bodies meeting the faces alone; S8's every-frame rebuild; everything parked inside the solid and back out; a grown water with no inside; S9's boxes and hulls of 3 and 90 cm landing and resting |
| the directive | flat cost across rungs (D14): a toy on the desk is one box from 10⁹ to a googolplex; a smash makes ten pieces with exact counts and the same physics commands per shape; a keep is a few hundred bytes at every rung; inside views of the 10³⁰, googol and googolplex rungs cut identically (the 10⁹ rung, cut from its root, costs less) |
| building | the tray and its beads; water from O, H, H carried together, kept as `source: built` with its XYZ, its own leaf as reference and parts O, H, H, reloading with the same bonds; ethanol from C, C, O and one Fill, named by graph (not dimethyl ether); a peroxide's halves that never rejoin alone, a fragment kept and reloaded, then rebuilt by hand; KCl built, broken, potassium joining the tray, a fragment naming its built parent; whole molecules bouncing; the guest gliding to the host's scale; Still snapping at once; determinism |
| device spikes | spike A3's toss: up and spinning about the intermediate axis, landing, damping restored; no flip on the stand-in, which has no gyroscopic terms; refused for a spherical top |
| polish (M4) | tryptophan flopping in three segments whose meshes make the whole, then settling straight; the switch and stiff molecules; a buckyball ringing at the wall, stretched and squashed in turn; plaques with reasons and feel, in play and in the Collection (a kept peroxide and a kept googolplex); VoiceOver's description, spoken counts (a googolplex spoken) and toss; the thermal policy's order, 30 fps only with A5, ten cool seconds before 60 again; no particles at critical and a loose piece poofed after 30 s, whole molecules kept; the first-run card |
| camera rays and rotations, merged meshes, juice router | ray and projection round trips (off-centre too), launch impulses inverting to the release velocity, icosphere and half-bond counts, dotted ionic contacts, the impact window, surfaces, reduced mass, squash and lean |

The stand-in physics is good enough to test the session's logic, not to tune
feel: restitution, friction and spin on the device come from RealityKit, and
spike S9's landings on the stand-in say nothing about RealityKit's solver at
3 cm and 90 cm. The directive's frame times are this machine's, not a phone's.
