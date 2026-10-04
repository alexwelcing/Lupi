# LupiKit

The pure-Swift core of the native Lupi AR game (`docs/ar/decisions.md`).
Foundation only, so it builds and tests on Linux CI as well as in Xcode;
everything that needs RealityKit, ARKit, SwiftUI or Core Haptics lives in the
app. Swift 6 language mode; platforms iOS 26 and macOS 26.

| Target | What it holds |
|---|---|
| `LupiChem` | The element table (generated from the web's), the XYZ / extended-XYZ parser, `Molecule`, a port of both bond recipes (`lupi-bonds.molecular.v1`, `lupi-bonds.distance.v1`) and the recipe gate, `BondGraph` (orders estimated from length, components, bridges, rings, rotatable bonds, weakest bonds, fragments), valence and snapping rules, inertia |
| `LupiPlay` | `GameUnits` (scale and felt mass) and `lupi.personality.v1` derived from the bond graph |
| `LupiData` | `lupi.trophy.v1`, `lupi.shelf.v1`, the edge client, SHA-256, and the twelve bundled starter molecules |

## Build and test

```bash
cd apps/apple/LupiKit
swift build
swift test
```

On Linux, put a Swift 6 toolchain on `PATH` first. Tests use Swift Testing and
never touch the network.

## Generated files

Each generator has a `--check` mode that fails when its output is stale.

| Command | Writes |
|---|---|
| `pnpm exec tsx tools/apple/gen-elements.mts` | `Sources/LupiChem/Elements.generated.swift` from `packages/core/src/elements.ts` (plus PubChem van der Waals radii) |
| `pnpm exec tsx tools/apple/export-bond-fixtures.mts` | `Tests/Fixtures/bonds/*.json`: the TypeScript `perceiveBonds`, `parseXyzText` and `computeInertia` on the 24 OMol25 picks, 25 gallery molecules and 48 synthetic cases |
| `pnpm exec tsx tools/apple/export-edge-samples.mts` | `Tests/Fixtures/data/*`: `/m/manifest.json` from the molecule-pages builder and OMol25 responses from the Worker's `routeScienceData` |
| `pnpm exec tsx tools/apple/bundle-starters.mts` | `Sources/LupiData/Resources/starters/` |

Typecheck the generators with `pnpm exec tsc -p tools/apple/tsconfig.json`.

## Conventions

- **Coordinates are Float32 Å**, rounded exactly as the web's `Float32Array`
  (the parser ports the web's float scan), and bond distances are computed
  in double from them. That is what lets the Swift recipes reproduce the
  TypeScript ones pair for pair.
- **Play graph:** `BondGraph.forPlay` uses the molecular recipe wherever the
  viewer could (non-periodic, at most 2,000 atoms). Ionic contacts count for
  connectivity, so a salt cluster is one body until it breaks.
- **Bond orders are estimates** from length (`BondOrderEstimate`) until
  `lupi-bond-orders.v1` exists. They feed bond strengths and rotatable bonds.
- **Bond strengths** are mean bond enthalpies (Huheey, via LibreTexts), with
  Pauling's rule for pairs the table lacks. They order breaks truly; the
  absolute values carry the usual 10–20% error.
- **Scale:** 10⁸× (1 Å → 1 cm) for molecules, 10⁷× for colossi, times the
  player's grow/shrink. **Mass:** 50 g × (M / 18.015)^0.4, so H₂ weighs 21 g
  and hemoglobin 1.3 kg; growing multiplies by the display scale.
- **Personality:** `PersonalityTable.v1` is the tunable table; rules run in
  order (ionic, weak bond, stretched bonds, cage, small, rotors, fused rings,
  stiff) and each derivation carries its plaque line.
- **Records:** JSON with sorted keys and RFC 3339 UTC milliseconds
  (`LupiJSON`). A shelf never contains the room map.
