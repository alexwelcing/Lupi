# pmndrs `math` deep-dive: research digest (2026-09-27)

Scope: the new pmndrs math library (npm `math`, repo github.com/pmndrs/math). What it is, a module-by-module catalog, benchmarks, who builds it, gotchas, and what each module could do for Lupi's molecule and particle viewer. This is research only. Nothing in the Lupi repo was changed.

Method: I cloned the repo with full history and all branches, then read `README.md`, `API.md`, `skills/math/SKILL.md`, `package.json`, every `src/` entrypoint and the examples. I fetched npm registry metadata and download counts. I read the GitHub releases, issues and PRs through the web, and checked DeepWiki and the TypeDoc site. I also measured bundle sizes and ran indicative micro-benchmarks locally: `math@0.1.0` against `three@0.184.0`, `gl-matrix@3`, and `maath@0.10.8`, on Node v22.22.2. Anything marked **UNVERIFIED** could not be confirmed.

---

## 0. TL;DR

- **`math` is maath rebuilt and renamed.** The same GitHub repo was emptied on 2026-08-03 (commit `34f4549`, "feat: empty"). It was re-seeded from Isaac Mason's `mathcat` (a gl-matrix port), `gpucat` color, and new code (commit `d500b2e`), then renamed from `maath` to `math` on 2026-08-17 (commit `8a24199`). github.com/pmndrs/maath now resolves to pmndrs/math. The old code lives on the `maath` branch and the `maath@0.x` tags.
- **Status: v0.1.0 is the first release.** It went to npm on 2026-09-11 and is `latest`. `canary` publishes on every main merge (currently `0.0.0-canary-20260927-98762395`). Several useful additions are **canary-only, not in 0.1.0**: `smoothstep`/`smootherstep`, `random.inCircle`/`random.inSphere`, `euler.clone`/`copy`, `Const<T>` readonly inputs, and an allocation fix in `vec3.rotateX/Y/Z`.
- **Style: gl-matrix-like.** Types are plain tuples (`Vec3 = [x, y, z]`). Functions take `out` first and return it, aliasing is safe, nothing is allocated in hot paths, and long-lived state is caller-owned (springs, PRNGs, noise tables). There are no classes except the IK enums.
- **Tree-shaking is excellent under Rollup** (Vite's production bundler). `vec3.add` plus `normalize` costs 236 B minified. It is much worse under esbuild's namespace handling (6.9 KB for the same code).
- **No GPU parity.** There are no WGSL, TSL or GLSL twins of the noise or math. It is CPU and JS only. It does ship WebGPU-convention matrices (`perspectiveZO`, `orthoZO`, `frustumZO`, `frustum.setFromViewProjectionMatrixZO`).
- **three.js interop on main is manual:** `vec3.fromBuffer`/`toBuffer`, `m.elements` as a `Mat4`, and `toArray`/`fromArray`. A zero-copy `math/three` bridge exists as **open PR #50**, unmerged. The published skill already references it.

---

## 1. Identity, lineage, adoption

| Fact | Value | Source |
|---|---|---|
| npm name | `math` (name donated by @kaleb; the old `math` 0.0.0 and 0.0.3 date from 2011) | README Acknowledgements; registry `time` |
| First release | `math@0.1.0`, npm 2026-09-11T00:29Z; GitHub release "math@0.1.0" ("Add benches by @krispya", "feat: math canary by @isaac-mason"; changelog from maath@0.10.8) | registry.npmjs.org/math; /releases |
| dist-tags | `latest: 0.1.0`, `canary: 0.0.0-canary-20260927-98762395` | registry |
| Earlier canaries | `1.0.0-canary-<sha>-<date>` from 2026-08-16 to 2026-09-07. Switched to a `0.0.0-canary-` base in commit `a1f682a` (2026-09-11) | registry, git log |
| Maintainers (npm) | `isaacmason`, `krispyaa` | registry |
| Author field | Isaac Mason | package.json |
| License / deps | MIT, zero runtime dependencies, `"sideEffects": false`, `"type": "module"`, `exports` has only `import` and `types` conditions (ESM-only) | package.json |
| Repo stats | about 1.3k stars (inherited from maath), 38 forks, 373 commits on main | github.com/pmndrs/math |
| Weekly downloads (2026-09-20 to 09-26) | `math` 4,755; `maath` 4,852,522 (mostly transitive via drei); `mathcat` 1,139; `gl-matrix` 11,037,104 | api.npmjs.org |
| Commit authors (all history) | Isaac Mason 162; Gianmarco Simone 93+14 (mostly the maath era); Kris Baumgartner 25+2; drcmda 8; Cody Bennett 3; Paul Henschel 3; RodrigoHamuy, aamtt (matt), others | `git log` |

**Relationship to maath.** `math` supersedes maath in the same repo, but maath is **not deprecated on npm**: `maath@0.10.8` (2024-07-07) is still `latest` and has no deprecation flag. The last maath-named canary is `1.0.0-canary-39fbc9bc-20260817`. drei `10.7.9` (2026-09-25) and `11.0.0-alpha.7`, and `@react-three/postprocessing` `3.1.3`, still depend on `maath ^0.10.8`. Nothing in the R3F or drei ecosystem depends on `math` yet. In Lupi, maath arrives only transitively: `maath@0.10.8` via drei and `maath@0.6.0` via `@react-three/postprocessing@2.19.1` in `apps/web` (`pnpm-lock.yaml:6047-6053`, `:11270`, `:11354`). Lupi source never imports maath directly.

What was dropped from maath, so there is no drop-in replacement:
- THREE-typed damping helpers: `easing.damp2/3/4`, `dampE` (Euler), `dampC` (Color), `dampQ` (Quaternion), `dampM` (Matrix4), `dampS` (Spherical), `dampLookAt`, plus the `maxSpeed`, custom-easing and `eps` args of `damp`.
- Whole-buffer helpers: `buffer.*` (swizzle, addAxis, lerp, rotate, map, sort, reduce, center, expand).
- Whole-buffer random fills (`random.inSphere(buffer, {radius, center})`, `onSphere`, `inBox`, `inRect`).
- `misc.fibonacciOnSphere`, `pointOnCubeToPointOnSphere`, and the 1D/2D/3D index helpers.
- `geometry.RoundedPlaneGeometry` and the box, sphere and cylindrical UV generators.
- `FlashGen`.
- maath's global-seed noise (`noise.seed`, `simplex3`, `perlin3`).

---

## 2. Philosophy, API style, size, interop

**Stated pillars (README):**
- "High performance: allocation-free, monomorphic, benchmarked"
- "Tiny: … tree-shakable"
- "Portable: interops with WebGL, WebGPU, Wasm, your favourite renderer"
- "Data-oriented: data-in, data-out functions over caller-owned data, without owning the data lifecycle"

Two open design-principle issues from krispya fill in the thinking:
- #49 "Optimization Principles": Smi integers, bit ops, type stability, consistent call-site types, and leaning on `Math.*` built-ins.
- #48 "Determinism": `Math.sin` differs across browsers; the question is whether to offer cross-platform deterministic variants. Still open with no answer.

**Types.** Every type is a fixed-length plain-array tuple:

| Type | Layout |
|---|---|
| `Vec2`, `Vec3`, `Vec4` | 2, 3, 4 numbers |
| `Quat` | `[x, y, z, w]` |
| `Quat2` | dual quaternion, 8 numbers |
| `Euler` | `[x, y, z, order?]` |
| `Mat2`, `Mat2d`, `Mat3`, `Mat4` | 4, 6, 9, 16 numbers, column-major; `Mat4` translation in `[12..14]`, same as three's `Matrix4.elements` |
| `Spherical`, `Polar` | `[r, theta, phi]` (three.js convention), `[r, theta]` |
| `Box2`, `Box3` | flat min/max tuples |
| `Sphere`, `Plane3`, `OBB3`, `Circle` | small objects (`{center, radius}` etc.) |
| `Frustum` | tuple of six `Plane3` objects |

Constructors just return literals.

**Call style.** `fn(out, ...inputs): out`, and inputs may alias `out` (`vec3.normalize(v, v)`). Scalars and booleans return directly. Stateful things are plain objects you allocate once and mutate: `Spring<T> = {value, velocity}`, `Mulberry32 = {a}`, `Isaac32` holding `Uint32Array`s, and a noise `Permutation = {perm: Uint8Array, grad3, grad4}`. Because state is plain data it can be serialized or forked with `structuredClone`.

**Typed arrays, offsets and SoA:**
- Only `vec2/vec3/vec4/quat.fromBuffer(out, buffer, startIndex)` and `toBuffer(buffer, v, startIndex)` take an `ArrayLike`/`MutableArrayLike` plus an offset.
- Matrices go through `TypedArray.set(m, i*16)`.
- There is no stride or SoA API and no whole-buffer map (maath's `buffer.*` is gone).
- Geometry algorithms take flat `readonly number[]` plus a count (`quickhull3(points)`, `polygon2.area(vertices, n)`) and return new arrays.
- You *can* pass `Float32Array.subarray` views as `Mat4` or `Vec3` at runtime; TypeScript needs `as unknown as Mat4`. The PR #50 bridge does exactly this (`instanceMat4Views`).
- The skill warns: "Mixing plain arrays and typed arrays in the same math function can make element accesses polymorphic … Marshal at boundaries". I reproduced this. The same `mat4.fromRotationTranslationScale` bench ran 180 µs alone but 974 µs when the process had also fed it plain arrays (§4).

**Bundle size (measured; Rollup 4 with node-resolve and terser, gzip -9):**

| Import | min | gz |
|---|---|---|
| `vec3.add` + `vec3.normalize` | 236 B | 202 B |
| `frustum.create` + `intersectsSphere` | 386 B | 194 B |
| `spring3.create` + `update` | 578 B | 361 B |
| `simplex3d` + `curl3` | 3,025 B | 1,538 B |
| `quickhull3` | 5,924 B | 2,287 B |
| entire `math` core (`import *`) | 60,723 B | 14,369 B |

With esbuild (Vite dev pre-bundling), `export * as vec3` namespaces are not shaken per function. `vec3` alone was 6,947 B (2,442 gz), and all eight entrypoints together were 146,818 B (42,812 gz). Lupi's `apps/web` uses Vite `^6` (`apps/web/package.json:41`), whose production build is Rollup, so production gets the small numbers.

**three.js interop.**

On main and in 0.1.0 there is no three dependency and no converters. `math` complements three's math classes rather than replacing them, because three's renderer, loaders and scene graph still use `Vector3`, `Matrix4` and friends. Integration is "marshal in, compute, marshal out" (skill, "Working with other libs"):
- `object.position.toArray(scratch)` and `fromArray` back.
- `vec3.fromBuffer` on attributes.
- `mesh.instanceMatrix.array.set(m, i*16)`.
- `camera.projectionMatrix.elements` used directly as a `Mat4`, since the layouts match.

**PR #50, `math/three` (open, krispya, 2026-09-07, branch `feat/three-bridge`).** An optional subpath with `three >=0.166` as an optional peer dependency.

- **Hot-path API:**
  - `extend(scene)` swaps Object3D `position`/`quaternion`/`scale`/`rotation` for accessor views over math tuples.
  - `transformOf(obj)` returns `{position, rotation: Quat, scale, local: Mat4, world: Mat4}`.
  - `propagate(scene)` does a flat parents-first world-matrix pass.
  - `extendObject`, `release` and `unextend` round out the lifecycle.
- **Helpers:**
  - Transforms and instancing: `claimTransform`, `instanceMat4Views(mesh)`, `mat4Of(m)`.
  - Attributes and culling: `vec3From/ToAttribute` (normalization-aware), `frustumFromCamera`, `sphereToWorld`.
  - Copies: `vec3From/ToVector3`, `quatFrom/ToQuaternion`.
- The code comments say objects added later are picked up via three's `childadded` event, "so loaders, clone(), react-three-fiber and friends are covered automatically". Classes overriding `updateMatrixWorld` (cameras, SkinnedMesh) keep their own traversal.
- **Claimed speedups (from the PR description; not reproduced by me):**

| Workload | Vanilla three | math/three | Speedup |
|---|---|---|---|
| Instanced transforms, 10k | 728 µs | 318 µs | 2.3× |
| Scene graph, 4,096 nodes (extend) | 777 µs | 331 µs | 2.3× |
| Scene graph, 4,096 nodes (per-object mirror) | 777 µs | 284 µs | 2.7× |
| Frustum culling, 4,096 meshes | 293 µs | 152 µs | 1.9× |
| Vertex transform, 8,481 vertices | 127 µs | 59 µs | 2.2× |
| Scene graph step + position/rotation reads | 820 µs | 606 µs | 1.4× |

- **Gotcha:** `skills/math/SKILL.md` on main (updated 2026-09-25) already documents `import { extend, transformOf } from 'math/three'`, but `./three` is **not** in the published `exports`. Copying the skill's example fails on 0.1.0 and on the current canary.

**GPU, WGSL, TSL.**
- There are **no** shader ports. `grep -i "wgsl|tsl|glsl"` over `src/` finds only a comment saying `smoothstep` matches GLSL.
- The GPU-facing parts are the zero-to-one depth variants (`mat4.perspectiveZO`, `orthoZO`, `frustumZO`, `perspectiveFromFieldOfViewZO`, `frustum.setFromViewProjectionMatrixZO`).
- Everything is plain arrays, so it uploads with `Float32Array.set`.
- The examples render with Isaac Mason's `gpucat` (a WebGPU renderer, with a WebGL fallback added in commit `caded07`) and `dashcat` panels, not three.js.

**Wasm spike, PR #51 (draft, krispya, 2026-09-07).**
- A 394-byte Wasm SIMD kernel for `world[i] = world[parent[i]] * local[i]`.
- Reported about 138 µs for JS plain arrays, about 113 µs for Wasm scalar, and about 34 µs for Wasm SIMD: roughly 4.0×, about 1.2× from flat memory layout and 3.2× from SIMD.
- f32 precision stays within epsilon up to 255 levels deep.
- Open questions in the PR: whether it becomes a `math/wasm` entrypoint or a separate package, and whether scene flattening belongs in this library.

**Other open design threads.**
- #46 "Operation overloading" (krispya, 2026-08-13) references software-mansion `tsover` and `boperators`: "there is no easy way to work around TS here."
- #60 (clementroche, open): make `repeat` a true floored modulo, fixing `repeat(-1e-17, 1) === 1` and `repeat(1e16, 3) === 0`.

---

## 3. Module catalog

Each module is followed by a **Unlocks** line saying what it could do for a molecule or particle viewer.

### `math`: core (`src/core/*`)
- **Scalars:**
  - `EPSILON`, `round` (symmetric), `equals`, `lerp`, `clamp`, `remap`, `remapClamp`.
  - `fade` (Perlin 6t⁵−15t⁴+10t³), `lagrange` (3-point quadratic), `binomial`, `repeat`.
  - Canary only: `smoothstep` and `smootherstep`, GLSL-matching and step-safe when edges are equal (PRs #61, #65).
  - Angles: `wrapAngle` to (−π, π], `deltaAngle`, deg/rad constants and converters.
- **`vec2`/`vec3`/`vec4`:** the gl-matrix surface (add, sub, scale, `scaleAndAdd`, `dot`, `cross`, `normalize`, `lerp`, `distance`, `squaredDistance`, min/max/floor/ceil, `transformMat3`/`Mat4`/`Quat`, `equals`, `finite`, aliases), plus:
  - `vec3.slerp`, `hermite`, `bezier`, `lagrange`, `perpendicular`, `signedAngle(a, b, axis)`, `rotateTowards(out, from, to, maxAngle)`, `rotateX/Y/Z` about a pivot, `isScaleInsideOut`, `setScalar`.
  - `vec2.signedAngle`, and `vec2.cross` returning a `Vec3`.
  - `vec4.cross` (the 4D triple product).
- **`quat`:** `setAxisAngle`, `fromEuler`, `fromDegrees`, `fromMat3`, `fromMat4`, `rotationTo` (shortest arc), `setAxes`, `slerp`, `sqlerp` (spherical cubic), `exp`, `ln`, `pow`, `invert`, `conjugate`, `rotateX/Y/Z`, `getAxisAngle`, `getAngle`, `calculateW`, `fromBuffer`/`toBuffer`.
- **`quat2` (dual quaternions):**
  - `fromRotationTranslation`, `fromMat4`, `multiply`, `lerp` (plain lerp, no ScLERP), `normalize`, `translate`, `rotateAroundAxis`, `rotateByQuatAppend`/`Prepend`, `getTranslation`, `getReal`, `getDual`.
  - The gallery includes a dual-quaternion "candy-wrapper" skinning demo.
- **`euler`:** six orders; `fromQuat`, `fromRotationMat4`, `reorder`, `fromDegrees`; `clone`/`copy` are canary-only.
- **`mat2`/`mat2d`/`mat3`/`mat4`:**
  - Full gl-matrix set.
  - `mat4` adds `decompose` into quaternion, translation and scale; `fromRotationTranslationScale(Origin)`; `lookAt`/`targetTo`; `invert3x3`; the `multiply3x3*` family; `crossProductMatrix`; `frob`.
  - NO and ZO variants of `perspective`, `ortho`, `frustum` and `perspectiveFromFieldOfView`.
- **`spherical`** (`[r, theta, phi]`, three convention): `setFromVec3`, `toVec3`, `makeSafe` (pole clamp), `lerp` (shortest angles), `angleTo` (great-circle), `fromVec2`/`toVec2`.
- **`polar`**: the 2D equivalents, plus `rotate` and chord `distance`.
- **Unlocks:**
  - Allocation-free per-atom and per-instance transform composition.
  - `quat.rotationTo` for bond-cylinder orientation (the same job as `Quaternion.setFromUnitVectors`).
  - `spherical` and `deltaAngle` for orbit and turntable cameras.
  - `vec3.rotateTowards` for capped-speed "look at the atom I tapped".
  - `quat.sqlerp` and `vec3.bezier`/`hermite` for smooth flythrough splines.
  - `quat2` for interpolating rigid fragments between trajectory frames without shrinkage.
  - ZO matrices for the WGSL and vgpu paths.

### `math/shapes`: primitives and queries
- **`box2`/`box3`** (flat 4- and 6-tuples): expand by point, extents or margin; `union`, `center`, `extents`, `size`, `area`/`surfaceArea`, `scale`, `box3.transformMat4`; `contains*`; `intersectsBox3`, `intersectsSphere`, `intersectsPlane3`, `intersectsTriangle3` (SAT); `box2.intersectsCircle`.
- **`obb3`** (`{center, halfExtents, rotation: Mat3}`): `setFromCenterHalfExtentsQuaternion`, `setFromBox3`, `applyMatrix4`, `clampPoint`, `containsPoint`, `intersectsOBB3` (SAT), and an `intersectsBox3` fast path.
- **`plane3`:** `fromNormalAndPoint`, `fromCoplanarPoints`, `distanceToPoint` (= dot(n, p) + constant), `projectPoint`, `intersect` (three planes), `transform`, `intersectsSphere`.
- **`sphere`:** only `create` and `containsPoint`. **`circle`:** only `create`.
- **`segment2`:** `closestPoint`, `intersects`, `intersection`.
- **`polygon2`** (flat `number[]` plus `n`): signed and unsigned `area`, `centroid`, `perimeter`, `winding`, `reverse`, `bounds`, `closestPoint`, `signedDistance`, `overlapConvex` (SAT), `containsPoint` (convex or concave), `isConvex`, `isReflexVertex`, `intersectsSegment`.
- **`triangle2`:** `signedArea`, `area`, `centroid`, `bounds`, `containsPoint`. **`triangle3`:** `bounds`, `normal`, `centroid`.
- **`raycast3`:** `intersectsTriangle(out, origin, dir, length, a, b, c, backfaceCulling)` writing `{fraction, hit, frontFacing}`, and `intersectsBox3` (slab test).
- **`frustum`:**
  - `setFromViewProjectionMatrixNO`/`ZO`(proj, view).
  - `setFromViewProjectionMatrixSides`, which uses only the four lateral planes, with `sides*` query variants.
  - `intersectsSphere`, `intersectsBox3` (p-vertex), `containsPoint`, `intersectsRay`, `corners`.
- **Gotcha:** there is no ray-vs-sphere test. Picking a sphere impostor atom needs a few lines of your own on top of `vec3`.
- **Unlocks:**
  - CPU frustum culling and LOD for brick or chunk structures, with no allocation.
  - Lasso selection on mobile: project atoms to screen, then `polygon2.containsPoint` against the drawn loop.
  - Box- and OBB-fitted "selection cages" and crop or clip volumes (`obb3.containsPoint`).
  - Unit-cell boxes; clip planes (`plane3.distanceToPoint` for slicing a crystal).
  - Triangle raycasts against isosurface or hull meshes.
  - `frustum.corners` for tight shadow or camera fitting.

### `math/geometry`: algorithms (these allocate and return new arrays)
- `quickhull3(points)`: flat xyz in, triangle indices out (incremental QuickHull).
- `quickhull2(points)`: CCW hull indices.
- `circumcircle(out: Circle, a, b, c)`.
- `triangulatePolygon2(out, vertices, n)`: ear clipping, returns the triangle count.
- `decomposePolygon2Quick` (Bayazit) and `decomposePolygon2Quality` (near-minimum convex pieces).
- There is no Delaunay, Voronoi, Poisson-disk or marching cubes.
- **Unlocks:**
  - Instant "shrink-wrap" convex-hull shells around a molecule, cluster or selection (a faceted glass hull, crystal-habit look).
  - Filled 2D cut-throughs of drawn shapes; convex pieces for simple 2D physics toys.
  - Circumcircle overlays for a teaching mode.

### `math/time`: easing and springs
- **`easing`:** `linear`, `exp`, and In/Out/InOut variants of `sine`, `cubic`, `quint`, `circ`, `quart` and `expo`, plus `rsqw` (rounded square wave). There is **no back, elastic or bounce**.
- **`spring`, `spring2`, `spring3`, `spring4`:**
  - `create(value)`.
  - `update(state, target, smoothTime, dampingRatio, delta)`.
  - `damp(state, target, smoothTime, delta)`, which is `update` with ζ = 1.
  - `spring.dampAngle` for the shortest path across ±π.
  - `spring.fromResponse(response)`, which converts a SwiftUI-style period to `smoothTime` (`response / π`).
- **Model** (`src/time/spring-core.ts`):
  - A damped harmonic oscillator integrated with the **exact analytic solution**, with separate branches for critically damped, under-damped and over-damped cases.
  - `omega = 2 / smoothTime`.
  - The source says it is "unconditionally stable at any frame delta, and behaviourally equivalent to Unity SmoothDamp / OG maath damp for the critical case".
  - Two dials: `smoothTime` (roughly the time to reach the target) and `dampingRatio` (1 = no overshoot, below 1 bouncy, above 1 sluggish).
  - There is no `maxSpeed`, no quaternion, euler or color spring, and no "settled" helper.
  - Coefficients (`exp`, `sin`, `cos`) are recomputed on every call, and the shared cache is not exported. Thousands of springs with the same parameters pay that repeatedly.
- **Unlocks:**
  - Frame-rate-independent, overshoot-tunable camera, target, zoom and pointer followers.
  - Squishy "bouncy" UI and HUD parameters.
  - Per-atom "jelly" responses (atoms springing back after being flicked or pinched) for a few thousand atoms on the CPU.
  - Stable in background-tab dt spikes without clamping.

### `math/random`: seeded PRNGs
- **`mulberry32`:** `{a}` state; `create(seed)`, `next` (uint32), `sample` in [0, 1), `seed()`.
- **`isaac32`:** 256-word batches in `Uint32Array`s, cycle length of at least 2^40 per source comments; `create`, `next`, `sample`, `seed`.
- **`isaac64`:** BigInt seed and output; `next` returns a `bigint`.
- **`random.*` helpers** take any `RandomGenerator = () => number`, so you wrap a PRNG as `() => mulberry32.sample(s)`:
  - `float`, `int` (inclusive), `bool`, `sign`, `choice`.
  - `vec2`/`vec3`/`vec4` unit directions (Marsaglia for vec4) and `quat` (uniform random rotation).
  - `inCircle`/`inSphere` are **canary-only**. They are area- and volume-uniform via sqrt and cbrt.
- Issue #57 (tallneil) flagged Fibonacci-sphere, rejection-cloud and fan-direction generators that were duplicated and orphaned in the examples. PR #64 closed it by adding only `inCircle`/`inSphere`, so **Fibonacci-sphere and Poisson-disk generators are not in the library**.
- **Unlocks:**
  - Deterministic "seeded scenes": a seed in the share URL reproduces exact backgrounds, particle births, flythrough paths and "random molecule" picks across reloads and devices.
  - Random uniform orientations for crystal grains or powder-diffraction style scatters.
  - Reproducible headless QA renders.

### `math/noise`: procedural noise
- **Generators**, each created with `.create(seed)` and sampled with `.sample(gen, …)`:
  - `perlin2d`, `perlin3d`.
  - `simplex2d`, `simplex3d`, `simplex4d`, each returning [−1, 1].
  - `worley2d`, `worley3d`: F1 distance only, roughly [0, 1]. There is no F2 and no cell id.
- **Fractal combinators** take a sampling callback, so they work with any generator:
  - `fbm`, `ridged` ([0, 1]), `billow`.
  - `domainWarp2`/`domainWarp3(out, sample, x, y, [z], amount)`.
  - `curl2`/`curl3(out, sample, …, eps = 1e-4)`: divergence-free flow by central differences. `curl3` costs 12 samples per call.
- **Seeding gotcha:** `createPermutation` XORs a fixed table with `seed & 255` and `(seed >> 8) & 255`, so only the low 16 bits matter. There are at most 65,536 distinct fields (`src/noise/permutation.ts:101-137`).
- **Unlocks:**
  - Thermal "breathing" jitter on atoms.
  - Curl-noise swirl for idle particle clouds on the CPU at modest counts (roughly 5–10k per frame; see §4).
  - Seamless looping motion for GIF or video export using `simplex4d` with two axes on a circle (the gallery has this exact demo).
  - Worley cellular backdrops ("cell membrane" or foam looks).
  - fBm and ridged fields for procedural backgrounds.
  - Because noise is CPU-only, anything at the 100k-plus particle scale still needs WGSL or TSL noise on the GPU.

### `math/color`
- **`Color`** = linear-sRGB `[r, g, b]`.
- **`color`:**
  - Create and convert: `setFromSRGB`/`toSRGB`, `toCSS`, `toHex`, `toHexString`.
  - Arithmetic: `add`, `sub`, `multiply(Scalar)`, `lerp` (linear-light, physically correct), `clamp`.
  - Queries: `luminance` (Rec. 709), `equals`.
  - Parsing: `setFromColorInput`/`fromColorInput` accept `#rgb`, `#rrggbb`, `rgb()`, `hsl()`, 0xRRGGBB, CSS names, and linear `[r, g, b]`. Unrecognized input logs `console.warn` and returns `null`.
- **`colorspace`:** `srgbToLinear`, `linearToSrgb`, `linearSrgbToLinearDisplayP3` and the reverse.
- **`hsl`:** `fromColor`, `toColor`, `lerp` (shortest hue), `offset`.
- There is **no OKLab or OKLCH**, no HSV, and no gradient or palette helper.
- **Unlocks:**
  - Correct linear-light blending of CPK colors when morphing or highlighting.
  - Display-P3 for more vivid element colors on modern phones.
  - Luminance-based label contrast.
  - HSL hue-cycling for "party mode" palettes.
  - A perceptual ramp (OKLCH) would have to be hand-written.

### `math/ik`: FABRIK
- **`fabrik2`**, a port of the Caliko scenarios:
  - `Chain2`, `Bone2`, `Joint2`; local or global wedge limits; basebone constraints.
  - `Structure2` with connected chains.
  - `forward` (follower-only), `backward`, `iterate`, `solve`, `solveStructure`, `isReachable`, `getEffector`, `getBoneAngle`.
- **`fabrik3`:**
  - Ball joints (cone "rotor"), `GLOBAL_HINGE`/`LOCAL_HINGE` with reference-axis limits, rotor or hinge basebone constraints, connected chains.
  - `getBoneRotation(out: Quat, chain, i, up)` to orient bone meshes.
  - Chains mutate in place; creating them allocates.
- **Unlocks:**
  - "Grab and drag" playful manipulation of chain-like molecules (polymers, alkanes, peptide backbones, DNA strands) where the rest of the chain follows plausibly under bond-angle limits.
  - The "snek" demo pattern (`forward` only) turns any chain into a pointer-following creature.
  - Hinge limits roughly model bond-angle constraints. This is fun rather than chemically exact (**not** a force field).

---

## 4. Benchmarks

**Official.**
- `benches/` uses `@pmndrs/labs` ^0.9.0, which runs statistically rigorous fresh-process blocks with Mann-Whitney U and Hodges-Lehmann statistics.
- It covers core, noise, shapes, IK and composite algorithm benches: funnel pathing, frustum culling, raycast scene, transform hierarchy, and a sphere physics step.
- **No committed results and no comparisons against gl-matrix, three or maath** exist on main.
- The only published head-to-head numbers are PR #50 (§2: 1.4–2.7× over vanilla three for transform, culling and vertex workloads) and PR #51 (Wasm SIMD about 4× over JS for tree matrix multiply). Both are unmerged, and #51 was "measured on one container reported as unstable (±7.5%)".

**Local, indicative only.** Node v22.22.2 (V8), one container, each case in its own process, median of 25 runs, two repetitions. The scripts are reproduced in [bench.md](bench.md).

**A. 10k instances, compose TRS into `instanceMatrix`**

| Approach | Time |
|---|---|
| `math` `mat4.fromRotationTranslationScale` written **straight into Float32Array subarray views** | 179–180 µs |
| three `Matrix4.compose` + `setMatrixAt` | 245 µs |
| gl-matrix `fromRotationTranslationScale` + `buf.set` | 303–379 µs |
| `math` into a plain tuple, then `buf.set(tuple, i*16)` | 607–624 µs |
| three `Object3D` dummy + `updateMatrix` + `setMatrixAt` | 859–1018 µs |

Two things stand out. Copying a plain array into a Float32Array is slow, so the right pattern is to write into typed-array views. And when the same `math` function had seen both plain and typed arrays in one process, the views case degraded to 974 µs (megamorphic).

**B. 50k bounding spheres against a camera frustum**

| Approach | Time |
|---|---|
| three `Frustum.intersectsSphere` | 1,234–1,245 µs |
| `math` `frustum.intersectsSphere` | 1,357–1,364 µs |

These are roughly equal; `math` was about 10% slower here.

**C. 100k scalar springs, one step**

| Approach | Time |
|---|---|
| `math` `spring.damp` | 3.77–3.80 ms |
| `math` `spring.update` with ζ = 0.5 | 4.71–5.00 ms |
| maath `easing.damp(obj, 'v', …)` | 11.8–12.9 ms |

`math` is about 3× faster than maath.

**D. Noise**

| Approach | Time |
|---|---|
| `math` `simplex3d`, 200k samples | 9.26–9.32 ms (about 46 ns per sample) |
| maath `noise.simplex3`, 200k samples | 12.7–14.2 ms |
| `math` `curl3` over simplex3d, 50k evaluations | 25.3–26.7 ms (about 0.5 µs each) |

In practice, a 4 ms per-frame CPU budget allows only about 8k curl evaluations. The `math` gallery's own flow-field demo uses 2,200 CPU particles.

Takeaway: the wins are real where Lupi uses the slow three idioms (Object3D dummy, per-frame allocation). They are modest to nil against three's already-tight paths such as `Matrix4.compose` and `Frustum`. CPU noise does not replace GPU noise at particle scale.

---

## 5. People and adjacent projects

- **Isaac Mason** (isaac-mason): lead author.
  - Libraries: `mathcat` (the ancestor; a TypeScript gl-matrix-style port, npm 0.0.14), `crashcat` (rigid-body physics, npm 0.0.5), `navcat` (navmesh and pathfinding, npm 0.4.1), `gpucat` (a node-based WebGPU renderer the examples use), `dashcat` (debug panels).
  - As of npm `latest`, crashcat depends on `mathcat 0.0.13` and navcat on `mathcat 0.0.12`, **not** `math`.
  - The source describes `math` as a port of mathcat, but whether crashcat and navcat will migrate is **UNVERIFIED**.
  - The benches' "@nav", "@physics" and "@raycast" composite workloads mirror those libraries' needs.
- **Kris Baumgartner** (krispya): co-maintainer on npm.
  - Also leads `koota` (pmndrs ECS/state, `0.6.6`) and the `@pmndrs/labs` bench harness.
  - Author of the open design issues (#46, #48, #49), the three bridge (#50) and the Wasm spike (#51).
  - His Threejs Conf 2026 talk repo (`krispya/threejs-conf-talk`, commits through 2026-09-24) is a real-world stack sample: `math` canary `0.0.0-canary-20260920-9969597f` alongside `@react-three/fiber 10.0.0-alpha.5`, `koota ^0.6.6`, `@pmndrs/glyph 0.1.0` and `three ~0.186.0`.
  - In that talk code, `math` usage is light: `easing.cubicInOut`/`cubicOut` (dozens of calls), `clamp`/`lerp`, and `mulberry32` plus `random.float`/`int` for deterministic motion.
- **Gianmarco Simone** (gsimone): original maath author; still contributing (smoothstep, PR #61).
- **Other contributors:** Cody Bennett (maath maintainer), drcmda (Paul Henschel, early maath README), clementroche (PR #60), RodrigoHamuy (readonly and euler PRs #52, #53, #62), aamtt (vec3 rotate PR #54), tallneil (issues #57, #58).
- **Pairing philosophy.** The skill's style (plain data, caller-owned typed-array "worlds", `createWorld`/`stepWorld`) is the ECS-friendly, data-oriented shape that koota traits and crashcat/navcat already use. That tuple-in-typed-array design suits koota SoA stores, though a first-class koota integration is **UNVERIFIED**.
- No official announcement blog post was found. An X post by @pmndrs (status 2084677636576436311) appeared in search but returned 403, so its content is **UNVERIFIED**.

---

## 6. Gotchas, stability, open issues

1. **0.x and churn.** Released 16 days ago, with 40 commits on main since 0.1.0. Main already has a breaking type change: PR #56 stopped re-exporting core types from `math/shapes`, so `import type { Vec3 } from 'math/shapes'` works in 0.1.0 but not in canary. The docs lag too: `API.md` on main lacks `smoothstep`, `inSphere` and `euler.clone`.
2. **Canary versioning trap.** Old `1.0.0-canary-*` versions sort *above* `0.1.0` in semver. Pin exact versions, and never use `^1.0.0-0` ranges.
3. **The skill documents unshipped code** (`math/three`); see §2.
4. **0.1.0 `vec3.rotateX/Y/Z` allocate two arrays per call.** Fixed on main in `55e8c25`/PR #54.
5. **`repeat` edge cases** (PR #60 open): `repeat(-1e-17, 1)` returns 1, and precision loss above 2^53.
6. **Determinism is not guaranteed across browsers** because of `Math.sin`, `exp` and friends (issue #48, open). Seeded PRNGs are integer-exact, but anything passed through trig is not bit-identical across engines.
7. **Only 65,536 distinct noise seeds** (§3, noise).
8. **Typed-array polymorphism.** Pick one storage kind per hot function. This was measured as a 5× slowdown when mixed (§4).
9. **Algorithms allocate:** quickhull, polygon decomposition and triangulation, FABRIK chain creation, and PRNG and noise table creation. Call them at setup or on edits, not per frame for large inputs.
10. **ESM-only exports** (no `require` condition). Vite is fine.
11. **What is missing** compared with a viewer's wishlist:
    - Ray-sphere tests, OKLab/OKLCH, and back, elastic or bounce easings.
    - Quaternion, color and euler springs.
    - Fibonacci-sphere and Poisson-disk generators, Delaunay, and GPU shader twins.

---

## 7. Lupi touchpoints (where `math` maps onto existing code)

- `packages/ui/src/lib/spring.ts:45-60`: an Euler-Cromer spring with a `MAX_STEP = 1/30` clamp, returning a new object each step. `math/time` `spring.update` is exact, clamp-free and mutates in place. `fromResponse` and `dampingRatio` map onto the existing stiffness/damping/mass config via ζ and ω.
- `packages/ui/src/scan/gist/gistEngine.ts:77,367-370`: `EASE = 0.06` per-frame lerp for energy, attract and fade, which is **frame-rate dependent** (it runs faster on 120 Hz phones). `spring.damp` fixes that.
- `gistEngine.ts:223-262`: a hand-rolled lookAt, WebGPU-depth perspective and 4×4 multiply that allocates three `Float32Array`s per call. This is `mat4.lookAt`, `mat4.perspectiveZO` and `mat4.multiply` into scratch.
- `gistEngine.ts:154-211`: `seedParticles` already takes an injectable `random`. A `mulberry32` wrapper gives reproducible scans.
- `packages/ui/src/ProceduralBackground.tsx:26-32`: a `sin`-hash `seeded()`, which is not portable-deterministic. At `:153` and `:174` there is a hand-rolled Fibonacci sphere. `mulberry32` plus `spherical.toVec3` covers both. A Fibonacci helper would still be user code.
- `packages/scene/src/BillionAtomBlock.tsx:294-346`: per-frame `THREE.Frustum` culling (parity with math, per §4). The same block allocates `atomCandidates` plus `sort` plus `new Set(...slice)` every frame (`:325-330`), a classic target for the skill's "allocate at creation" rule.
- `packages/ui/src/GhostAtoms.tsx:19,44-54`: the Object3D dummy, `updateMatrix` and `setMatrixAt` pattern, the slowest variant in bench A (about 5× slower than math into subarray views). It runs on every trajectory-frame change.
- The same idiom appears in `packages/ui/src/gpu-studio/runtime.ts:262-270` and `packages/scene/src/AtomsTransmission.tsx:193`.
- `packages/renderer/src/pipeline/AtomPipeline.ts:260-271,335-351`: `extractFrustumPlanes` allocates six `Float32Array`s per update and uses the WebGL (NO) near plane. `frustum.setFromViewProjectionMatrixZO` exists if this is ever fed a WebGPU projection. A repo grep shows `AtomPipeline` is exported, but the UI only calls `initWebGPU`, so this is low impact.
- `packages/ui/src/panels/FlythroughPanel.tsx:253-282`: random flythrough keyframes use `Math.random()`. Seeding them makes tours shareable and replayable, and `quat.sqlerp` or `vec3.bezier` could smooth the path.

---

## 8. Brainstorm seeds (unlocked capability → user-facing idea)

- **Analytic springs:** a "jelly molecule" where you flick an atom on mobile and neighbors spring back with a ζ slider from "honey" to "rubber". Pointer-follow camera wobble with no dt-spike explosions.
- **FABRIK:** grab a polymer or backbone end and drag it like a rope; a "snek" mode where a chain molecule follows your finger and eats atoms.
- **Seeded PRNGs:** "Molecule of the day", seeded by date and identical for every visitor; a seed in the share link reproduces the exact particle birth, background and flythrough.
- **quickhull3:** tap "wrap" to grow a faceted glass hull around the molecule or selection, then shatter it with springs.
- **polygon2:** draw a lasso on a phone to select atoms, or draw a shape and have atoms flow into it using `signedDistance` as a field.
- **Noise:** idle "breathing" thermal motion; `simplex4d` seamless-loop exports for social GIFs; Worley "cell" backdrops.
- **Color:** Display-P3 CPK "vivid mode"; physically correct linear blending for highlight pulses.
- **Frustum and OBB:** "x-ray box" crop volumes you drag with a finger; cheap CPU LOD for giant lattices.
- **quat2:** smooth rigid-fragment interpolation between conformers or trajectory frames (a "candy-wrapper-free" morph).

---

## Sources

- https://github.com/pmndrs/math (README, API.md, skills/math/SKILL.md, package.json, src/, examples/src/examples.json, benches/). Cloned locally at commit `9876239` (main, 2026-09-27), tag `math@0.1.0` (`ac8713e`), branches `feat/three-bridge` (`6e37053`), `claude/wasm-matrix-mult-simd-5pqf4h`, `maath`
- https://github.com/pmndrs/math/releases
- https://github.com/pmndrs/math/issues (#46, #48, #49, #57, #58) and https://github.com/pmndrs/math/pulls
- https://github.com/pmndrs/math/pull/50 (three bridge), https://github.com/pmndrs/math/pull/51 (wasm SIMD spike), https://github.com/pmndrs/math/pull/60 (repeat), https://github.com/pmndrs/math/pull/64 (inCircle/inSphere)
- https://pmndrs.github.io/math/examples/ and https://pmndrs.github.io/math/docs/ (TypeDoc)
- https://deepwiki.com/pmndrs/math (indexed 2026-08-25 at `dbc0c0c5`)
- https://registry.npmjs.org/math, https://registry.npmjs.org/maath, https://api.npmjs.org/downloads/point/last-week/{math,maath,mathcat,gl-matrix}
- https://registry.npmjs.org/{crashcat,navcat,mathcat,koota,@react-three/drei,@react-three/fiber,@react-three/postprocessing,three}
- https://github.com/pmndrs/maath (now resolves to pmndrs/math); maath@0.10.8 package contents (easing, random, buffer, misc declarations)
- https://github.com/isaac-mason/mathcat, https://github.com/isaac-mason/crashcat, https://github.com/isaac-mason/navcat, https://github.com/isaac-mason/gpucat
- https://github.com/krispya/threejs-conf-talk (package.json and src/ usage of math)
- https://github.com/pmndrs/react-three-fiber/discussions/3665 (R3F v10 alpha context)
- Local measurements: [bench.md](bench.md) (bench.mjs, rollup.config.mjs and the entries)
- Lupi code refs: `packages/ui/src/lib/spring.ts`, `packages/ui/src/scan/gist/gistEngine.ts`, `packages/ui/src/ProceduralBackground.tsx`, `packages/scene/src/BillionAtomBlock.tsx`, `packages/ui/src/GhostAtoms.tsx`, `packages/ui/src/gpu-studio/runtime.ts`, `packages/scene/src/AtomsTransmission.tsx`, `packages/renderer/src/pipeline/AtomPipeline.ts`, `packages/ui/src/panels/FlythroughPanel.tsx`, `apps/web/package.json`, `pnpm-lock.yaml`
