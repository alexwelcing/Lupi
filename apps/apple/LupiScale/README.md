# LupiScale

The scale spine of the native Lupi AR game: every structure from a water
molecule to a googolplex of salt as a small content-addressed graph, drawn,
touched, broken and kept at any magnification. It implements
[docs/ar/scale-spec.md](../../../docs/ar/scale-spec.md) (D14). Foundation
only, Swift 6 language mode, iOS 26 and macOS 26, so it builds and tests on
Linux CI as well as in Xcode.

| Target | What it holds | Spec |
|---|---|---|
| `LupiScaleCore` | Everything marked [B], with no dependencies: bytes, `BigUInt`, Q16, SHA-256 (package-internal), CRC-32, SplitMix64, node records of every kind, the generator registry v1, paths and canonical form, views and the `Resolver` (materialization, probes, removals), `Magnitude` and its exact formatting, compositions and masses, LupiPack v1 read and write with every conformance rule, `lupi.scale-ref.v1`, the partition bake | §1–§7 |
| `LupiScale` | Frames and the camera, the cut, physics and play, over `LupiScaleCore` and LupiKit's `LupiChem` and `LupiPlay`. It re-exports `LupiScaleCore`. | §8–§10 |

## Build and test

```bash
cd apps/apple/LupiScale
swift build
swift test                 # debug
swift test -c release      # byte-exact vectors again, and the timed cut
```

On Linux, put a Swift 6 toolchain on `PATH` first. Tests use Swift Testing,
read the gallery XYZ files from `apps/web/public/gallery` through LupiKit's
parser (file order, Float32), and never touch the network. The golden fixture
`Tests/Fixtures/scale-v1.json` is written by the TypeScript reference
(`packages/core/scripts/write-scale-fixtures.mts`) and copied here by
`pnpm exec tsx tools/apple/export-scale-fixtures.mts`; `pnpm apple:check`
fails when it is stale. `FixtureConformanceTests` asserts every value in it
byte for byte, and the §12 values are also hard-coded from the spec, so a
fixture that drifted from the spec fails too.

| Suite | Covers |
|---|---|
| `LupiScaleCoreTests` (104 tests) | every value of the golden fixtures (records both ways and what a writer canonicalizes, resolutions with counts, compositions, masses, copy keys, substitutions, probes and materialized leaves, formatting, arithmetic and comparison, the scientific display, packs, references, the partition bakes, and every rejection code); every §12 vector the core reaches, hard-coded from the spec; every §6.6 rejection; and §2 and §4 validation on corrupted inputs |
| `LupiScaleTests` (46 tests) | the §9.8 guarantees (an edited box draws nothing removed), frames (§8), budgets, τ and draw items (§9.3, §9.7), felt mass, heft, inertia and proxies (§10.1–§10.4, §10.8), breaking, chipping, Grow ×2 against the fixtures, and picking (§10.5–§10.7) |

`CutGuaranteeTests.buildCutCost` times `buildCut` at the fair column's 8,192
visits and fails a release build above 4 ms, taking the best of 15 frames
because Swift Testing runs other suites alongside it. On the Linux machine
these were written on it takes about 2.7 ms in release and 55 ms in debug;
a googolplex inside view (2,925 visits) about 3 ms in release. These are not
device numbers: the 1 ms device budget is spike S2's to measure.

## Conventions

- **Exact where the spec is [B].** Counts, masses, paths and identities are
  integers (`BigUInt`, `Magnitude`); binary64 enters only in [V] code (frames,
  aggregates, the cut, physics), and Float32 only when a draw item is cast,
  once (§8.5).
- **One frame per node.** A point is a node and local coordinates; a body
  carries its anchor path, `worldFromAnchor` and σ (§8.3). Tower descents of
  any length compose in closed form per digit run (§8.2).
- **The cut never throws.** A body that cannot resolve draws nothing and is
  listed in `Cut.failures`; a child that is not resident draws its parent.
- **Residency is keyed by values, not text** (`ResidentStore`): a seed
  copy's materialization by its exact path, a start's refKey by root and
  steps. Only new materializations hash.

Where the spec was wrong, ambiguous or silent, the decisions are folded into
it; its changelog ([§13.1](../../../docs/ar/scale-spec.md)) lists them.

## Not here yet

- **Eviction.** Residency and the resolver's caches grow without bound;
  `Budgets.residentBytes` is not enforced yet (§9.6's LRU).
- **LupiEngine (M3b) paths.** `atomsGPU` and `clusterSplats` items, fades
  (`DrawItem.fade` is always 1), and Hi-Z occlusion.
- **App-side work.** Merged-mesh builds, the atoms-scale-in swap, terrain
  collision windows and face-plane colliders (§10.1), Snap (§10.7), the
  gesture arbiter (LupiKit, §10.5) and trophy and shelf records (§7.4, §7.5)
  belong to the app or LupiKit. LupiScale supplies the paths, proxies, plans
  and draw items they consume.
