# LupiGame

The play session behind the native Lupi app: everything in M0's playable slice
and scale receipt that needs no Apple framework (plan §3–§5, §8 M0;
scale-spec §8–§10). The app in `apps/apple/Lupi` only turns RealityKit, ARKit
and SwiftUI events into `FrameInput` and applies the `FrameOutput` that comes
back. Foundation only, Swift 6 language mode, iOS 26 and macOS 26, so it builds
and tests on Linux CI as well as in Xcode.

| Target | What it holds |
|---|---|
| `LupiGame` | `PlaySession`: bodies as LupiScale `BodyFrame`s over scale references; the spawn queue (one a frame) and pop-in; the gesture arbiter of scale-spec §10.5; grab, hold and throw on LupiKit's `HoldFollow` and `ThrowEstimator`; pinch and twist through the anchor and the scale axis (§8.8) with size states (§10.1); breaks from LupiScale's `BreakPlan` with each piece's velocity at its centre plus 0.4 m/s outward, inset proxies, cooldowns and growth to 6 cm (§10.6); the juice router from contacts to LupiKit's `JuiceDirector` (the 50 ms impact window, Δv from felt or reduced mass, the surface hit); rest damping, out-of-bounds rescue and the 40-toy budget; terrain with parked toys; the cut every frame with the τ controller; the scale receipt (salt of 10³, 10⁶ and 10⁹ atoms) and its dive to 2 cm ions; the HUD with exact totals (`Magnitude.formatted`); merged-mesh geometry for molecules (`MeshBuilder`); camera rays from ARKit's projection |
| `LupiGameSim` | `StubWorld`, a deterministic stand-in for RealityKit's physics (gravity, damping, impulses, a desk and walls, bodies against each other, sleeping, `CollisionEvents`-like reports), and `Simulation`, which steps a session against it with scripted touches |

## Build and test

```bash
cd apps/apple/LupiGame
swift build
swift test
```

| Suite | Covers |
|---|---|
| catalog and the scale receipt | C₆₀ first in the tray; starters copied from the gallery are scale-spec §12.2's leaves; the receipt rungs are §12.4's towers with exact counts and 229-byte references; exact HUD totals |
| play session | spawn, float, land and settle (once); a flick at the wall with its juice; a set-down; hydrogen peroxide cracking into two hydroxyls with exact identities; pieces' inherited velocity and 0.4 m/s kick; the 10⁹ crystal smashing into ten pieces that share its felt mass; Sound & haptics off, Still comfort, iPad without haptics; the 40-toy budget; out-of-bounds rescue; every frame of the receipt within its budgets, cool and critical; requests between frames; determinism |
| scale in play | pinch on the footprint, one to one within 10^±32, mass unchanged; toy, monument and back; the dive into the 10⁹ crystal (terrain, parked toys, the bubble's wall within budgets, exact counts) and back out; the receipt within the critical column |
| gesture arbiter | recorded touch streams: tap, grab by move and by hold, pinch with and without a held body, twist, fly only beyond 10^±32, chunk and chip |
| device spikes | spike A3's toss: up and spinning about the intermediate axis, landing, damping restored; no flip on the stand-in, which has no gyroscopic terms; refused for a spherical top |
| camera rays and rotations, merged meshes, juice router | ray and projection round trips (off-centre too), launch impulses inverting to the release velocity, icosphere and half-bond counts, dotted ionic contacts, the impact window, surfaces, reduced mass, squash and lean |

The stand-in physics is good enough to test the session's logic, not to tune
feel: restitution, friction and spin on the device come from RealityKit.
