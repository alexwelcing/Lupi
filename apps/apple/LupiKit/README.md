# LupiKit

The pure-Swift core of the native Lupi AR game (`docs/ar/decisions.md`).
Foundation only, so it builds and tests on Linux CI as well as in Xcode;
everything that needs RealityKit, ARKit, SwiftUI or Core Haptics lives in the
app. Swift 6 language mode; platforms iOS 26 and macOS 26.

| Target | What it holds |
|---|---|
| `LupiChem` | The element table (generated from the web's), the XYZ / extended-XYZ parser and writer, `Molecule`, a port of both bond recipes (`lupi-bonds.molecular.v1`, `lupi-bonds.distance.v1`) and the recipe gate, `BondGraph` (orders estimated from length, components, bridges, rings, rotatable bonds, weakest bonds, fragments), valence and snapping rules, inertia |
| `LupiPlay` | `GameUnits` (scale), felt mass `lupi.feltmass.v1` (`FeltMass` over a `MassLog`, scale-spec §10.2), `lupi.personality.v1` derived from the bond graph, the motion tokens and exact springs (hold-follow, squash, pop-in, hit-stop), `MotionComfort`, the throw estimator, the juice director (haptics, sound cues and visuals per game event, with the rate limits) and the synthesized sound bank (Float32 PCM) |
| `LupiData` | `lupi.trophy.v1`, `lupi.shelf.v1`, the edge client, SHA-256, and the thirteen bundled starter molecules |

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
| `pnpm exec tsx tools/apple/export-bond-fixtures.mts` | `Tests/Fixtures/bonds/*.json`: the TypeScript `perceiveBonds`, `parseXyzText` and `computeInertia` on the 24 OMol25 picks, 25 gallery molecules and 48 synthetic cases; and `xyz-write.json`, a reference XYZ writer's text for built molecules and fragments with the web parser's reading of it |
| `pnpm exec tsx tools/apple/export-validation-sample.mts` | `Tests/Fixtures/bonds/validation-sample.json`: `validation-v1.json`'s targets, parameters, hand-check rows and totals, and 81 OMol25 neutral-validation rows with the TypeScript output (choosing rows needs the row cache below; `--check` does not) |
| `pnpm exec tsx tools/apple/export-edge-samples.mts` | `Tests/Fixtures/data/*`: `/m/manifest.json` from the molecule-pages builder and OMol25 responses from the Worker's `routeScienceData` |
| `pnpm exec tsx tools/apple/bundle-starters.mts` | `Sources/LupiData/Resources/starters/` |

Typecheck the generators with `pnpm exec tsc -p tools/apple/tsconfig.json`.

## Recipe validation

`packages/core/src/bonds/validation-v1.json` is the release receipt of
`lupi-bonds.molecular.v1` over all 27,697 rows of
colabfit/OMol25_neutral_validation. `swift test` holds the Swift port to it on
the committed sample: TypeScript's output row for row, the hard targets (no H
with two partners, nothing over the v1 caps, no line touching an s-block ion,
the same output again and with a shuffled grid), the seven hand-check rows
line for line, the validated parameters, and p99 at 350 atoms (held to the
5 ms target in release builds; debug builds only record it).

The full run checks every row:

```bash
NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/fetch-rows.mts        # ~250 MB down, 51 MB cached
pnpm exec tsx tools/apple/export-validation-sample.mts --row-keys .verify-artifacts/omol25-bonds/row-keys.tsv
cd apps/apple/LupiKit
LUPI_OMOL25_ROWS=../../../.verify-artifacts/omol25-bonds/colabfit__OMol25_neutral_validation \
LUPI_OMOL25_ROW_KEYS=../../../.verify-artifacts/omol25-bonds/row-keys.tsv \
swift test -c release --filter everyRow
```

It asserts the hard targets, every reported total (line kinds, removals by
reason, ions, contacts by element, long bonds, near misses), the hand-check
counts, the TypeScript lines of every row (by an FNV-1a key) and p99.

## Conventions

- **Coordinates are Float32 Å**, rounded exactly as the web's `Float32Array`
  (the parser ports the web's float scan), and bond distances are computed
  in double from them. That is what lets the Swift recipes reproduce the
  TypeScript ones pair for pair.
- **XYZ out:** `XYZWriter` writes `Symbol x y z` from each Float32's exact
  value (ties away from zero, as `toFixed`; never a signed zero) and a
  comment of a title and `key=value | …` pairs the parsers read back.
  `XYZWriter.embedded` is a trophy's XYZ (contracts.md §1.4): centred on the
  centre of mass, five decimals, `formula=`, `charge_source=unavailable`
  unless the charge is known, `coordinates=lupi-play`. Below 128 Å a written
  file reads back and writes again byte for byte, and a fragment or a built
  molecule reloads with the bonds it had.
- **Play graph:** `BondGraph.forPlay` uses the molecular recipe wherever the
  viewer could (non-periodic, at most 2,000 atoms). Ionic contacts count for
  connectivity, so a salt cluster is one body until it breaks.
- **Bond orders are estimates** from length (`BondOrderEstimate`) until
  `lupi-bond-orders.v1` exists. They feed bond strengths and rotatable bonds.
- **Bond strengths** are mean bond enthalpies (Huheey, via LibreTexts), with
  Pauling's rule for pairs the table lacks. They order breaks truly; the
  absolute values carry the usual 10–20% error.
- **Scale:** 10⁸× (1 Å → 1 cm) for molecules, 10⁷× for colossi, times the
  player's grow/shrink. **Mass:** `lupi.feltmass.v1` (scale-spec §10.2),
  whose canonical form, tail included, is LupiScale's `FeltMass`. LupiKit
  keeps only the branch below the 1,018 Da knee
  (`GameUnits.feltMass(molarMass:massScale:)`, 0.2 kg × (M / 180)^0.4 ×
  massScale, at least 0.06 kg; nil above the knee), pinned to the spec's
  numbers. Mass never grows with the display scale. A personality carries
  its `breakSpeed`; the impulse is felt mass × break speed.
- **Personality:** `PersonalityTable.v1` is the tunable table; rules run in
  order (ionic, weak bond, stretched bonds, cage, small, rotors, fused rings,
  stiff) and each derivation carries its plaque line.
- **Juice:** plan §5's tables are `JuiceDirector`'s; every number marked
  (est.) in the plan, and the fundamentals and partial weights of the sound
  bank, are starting values for the tuning pass on the device. Sound and
  haptics never depend on motion comfort; visuals do.
- **Throw:** plan §3.5. Feed one `HandSample` per frame while held (the
  touch ray's point at the grab depth, and the touch); the release is a
  least-squares slope over the last 100 ms, a flick boost, the caps, and
  spin from sideways speed, grab offset and the drag's curl.
- **Records:** JSON with sorted keys and RFC 3339 UTC milliseconds
  (`LupiJSON`). A shelf never contains the room map.
