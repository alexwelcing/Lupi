# LupiKit

The pure-Swift core of the native Lupi AR game (`docs/ar/decisions.md`).
Foundation only, so it builds and tests on Linux CI as well as in Xcode;
everything that needs RealityKit, ARKit, SwiftUI or Core Haptics lives in the
app. Swift 6 language mode; platforms iOS 26 and macOS 26.

| Target | What it holds |
|---|---|
| `LupiChem` | The element table (generated from the web's), the XYZ / extended-XYZ parser and writer, `Molecule`, a port of both bond recipes (`lupi-bonds.molecular.v1`, `lupi-bonds.distance.v1`) and the recipe gate, `BondGraph` (orders estimated from length, components, bridges, rings, rotatable bonds, weakest bonds, fragments), valence and snapping rules, building (`BondGeometry`: free directions from VSEPR domains; `Snapper`: the recipe's cutoffs, the magnet zone, the placement and its re-perception check; `HydrogenFill`; the `BuildCues` table; `MolecularGraph` for naming), inertia |
| `LupiPlay` | `GameUnits` (scale), felt mass `lupi.feltmass.v1` (`FeltMass` over a `MassLog`, scale-spec §10.2), `lupi.personality.v1` derived from the bond graph by `lupi.personality.rules.v1` (contracts.md §3.3) with its plaque reasons and `PersonalityRecord`, the motion tokens and exact springs (hold-follow, squash, pop-in, hit-stop), the flop (`FlopSegments`, `Flop`) and the cage ring (`CageRing`), `MotionComfort`, the throw estimator, the juice director (haptics, sound cues and visuals per game event, with the rate limits, and each personality's `Timbre`) and the synthesized sound bank (Float32 PCM) built from a `SoundTuning` |
| `LupiData` | `lupi.trophy.v1`, `lupi.shelf.v1`, the edge client, SHA-256, the thirteen bundled starter molecules, and `KnownMolecules`, what a built molecule is named after |

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
| `pnpm exec tsx tools/apple/bundle-known.mts` | `Sources/LupiData/Resources/known-molecules.json`: the gallery pages and featured OMol25 picks of at most 256 atoms that are one piece, as elements and the links the TypeScript molecular recipe perceives (86 molecules, 38 KB) |

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
  player's grow/shrink. **Mass:** `lupi.feltmass.v1` (scale-spec §10.2) is
  `FeltMass` over a `MassLog`: 0.2 kg × (M / 180)^0.4 × massScale, at least
  0.06 kg, below the 1,018 Da knee and a slow tail under 0.6 kg above it.
  LupiScale forms the `MassLog` from exact masses;
  `GameUnits.feltMass(molarMass:massScale:)` is the shorthand for daltons.
  Mass never grows with the display scale. A personality carries
  its `breakSpeed`; the impulse is felt mass × break speed.
- **Personality:** `PersonalityTable.v1` is contracts.md §3.3's table, number
  for number. The rules run in its order: brittle for ionic contacts,
  coordination, a weakest bond under 200 kJ/mol or a 3- or 4-membered ring;
  bouncy for an atom, a spherical top or a cage of rings with 20 heavy atoms;
  flexible from three rotating bonds; rigid otherwise. The personality's own
  bond orders come from the contract's length ratio (rule 1) and its energies
  from the cited table or the game defaults (rule 2); fragments and snapping
  keep `BondOrderEstimate`. Each derivation carries its reasons ("Brittle: its
  O–O bond is weak (142 kJ/mol)"), how it plays ("Bounces, and its cage
  rings") and whether it rings; `PersonalityRecord` is the contract's JSON.
- **Sound families** (plan §5.2, §8 M4): clack chatters (a second touch 7 ms
  later), thwap slaps with a small pitch drop, tink shimmers (a detuned twin),
  boing drops its pitch. Each body's `Timbre` adds its personality's layer: a
  cage rings (the low modes of a vibrating sphere, 1 : 1.52 : 2.09 : 2.72), a
  flexible molecule's loose ends flap a beat after the hit, a brittle one
  crackles when a hit reaches 60 % of its break speed. `SoundTuning.v1` holds
  every number, so the app's sound lab can change it and copy it back.
- **Flop and ring** (plan §8 M4): `FlopSegments` cuts a flexible molecule at
  the rotating bonds that split it most evenly into two to four pieces of at
  least three heavy atoms; `Flop` swings each about its hinge on a 2.4 Hz
  spring (damping 0.22, at most 0.6 rad), kicked by hits and by changes in
  what pushes the body, so resting and free fall leave it straight. `CageRing`
  shivers a cage along the hit at 9 Hz for about half a second. Both are
  render only and follow motion comfort.
- **Juice:** plan §5's tables are `JuiceDirector`'s; every number marked
  (est.) in the plan, and the fundamentals and partial weights of the sound
  bank, are starting values for the tuning pass on the device. Sound and
  haptics never depend on motion comfort; visuals do.
- **Throw:** plan §3.5. Feed one `HandSample` per frame while held (the
  touch ray's point at the grab depth, and the touch); the release is a
  least-squares slope over the last 100 ms, a flick boost, the caps, and
  spin from sideways speed, grab offset and the drag's curl.
- **Building** (plan §4.5): a snap needs the valence rule (`Valence.canBond`,
  the recipe's caps) and lands the guest's atom at the radius sum along the
  free direction of the host atom's ideal geometry nearest where the guest
  is, the guest turned so its own free direction points back. Domains count
  lone pairs (water's O is tetrahedral, an imine N trigonal). Up to three
  host directions and six turns about the bond are tried; the first whose
  merged atoms the recipe perceives as exactly both graphs plus the new link
  wins, otherwise the snap is refused. Snaps make single bonds. Fill places
  hydrogens on the roomiest free directions and drops any the check refuses.
  "Built it" is every atom at its usual valence (H 1, C 4, N 3, O 2,
  halogens 1, S 2, P 3) or a known molecule: same formula, same colour
  refinement signature and an isomorphic graph, orders ignored.
- **Records:** JSON with sorted keys and RFC 3339 UTC milliseconds
  (`LupiJSON`). A shelf never contains the room map.
