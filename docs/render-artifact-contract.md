# Lupi render artifact contract

Status: **Normative V1 contract; implementation candidate, not released**

Decision owner: Alex Welcing (`@alexwelcing`), repository owner

Prepared: 2026-07-19

This contract defines the boundary between a requested Lupi view, the renderer
that executes it, the immutable bytes that result, and the mechanism that
delivers those bytes. It complements the
[product ownership contract](product-ownership-contract.md) and
[release truth contract](release-truth-contract.md).

The current browser exporter and Cloudflare control plane are implementation
inputs to this contract. They are not, by themselves, proof that a durable
renderer is configured or that any public artifact satisfies this contract.

## Ownership outcomes

Lupi owns molecule-view rendering, canonical render intent, artifact bytes, and
artifact provenance. The browser viewer may render directly. The edge Worker
may validate, schedule, cache, and deliver work, but it remains browser-free and
must not claim pixels that no renderer produced.

A backend, browser, or consumer is conforming only when it returns the identity
fields, validates the produced bytes, and satisfies every visible-layer,
format, alpha, color, and tone rule below. Unsupported intent fails before an
artifact is stored or described as complete.

## Historical recovery ledger

Historical commits establish provenance, not current correctness. The original
`alexwelcing/lupine` tree has no merge base with this extracted repository, so
all recovery is path-selective.

| Evidence                                                                                                                                     | Already represented                                                                                                                                                                                                                                                                      | Recover selectively                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reject                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lupine PR 242, `2cc5b676e` (same two-file result as original branch tip `6a67f870`)                                                          | The current atom renderer retains the clearcoat prop and shader uniform in `packages/scene/src/AtomsOptimized.tsx`. Device classification already exists in `packages/ui/src/deviceCapabilities.ts`, and tone mapping is owned by `packages/ui/src/postprocess/ScenePostprocessing.tsx`. | Restore the missing clearcoat-uniform assignment and material-palette disposal. Add an adaptive DPR cap to `packages/ui/src/viewer/ViewerCanvas.tsx` using the current device classifier. Rebuild atom bounds as a tested helper that covers current positions, PBC-unwrapped interpolation targets, streaming counts, hidden types, and radius overrides before enabling frustum culling. Measure desktop and mobile performance and capture visual parity.                                                                    | Do not cherry-pick the patch. Its bounds cover only current positions and can exclude interpolated targets. Do not add renderer-level ACES/output-color settings that compete with the current postprocess tone owner.                                                                                                                                                       |
| Immutable `origin/shop-route` tip `1af30de8bba5f53322869ecb6802e2d9d6fdca16`, including the executor introduced at `17bc7d00` and `eb2ca630` | The browser already exports PNG, JPEG, WebP, GLB, and USDZ through `packages/ui/src/ExportManager.tsx` and `packages/ui/src/mcp/tools.ts`. The edge already owns deterministic request intake, jobs, R2 lookup, queue/HTTP handoff, and retrieval in `apps/mcp-worker/src/index.ts`.     | Recover only the executor shape: one bounded stateful browser lane, an exact co-built viewer, the typed browser MCP bridge, and PNG output first. Require bearer authentication, request and response limits, deadlines, output-signature validation, recomputed digest and length, identity matching, immutable storage, readback, and cache-hit proof. Treat PCA framing and transparency matting as design evidence requiring pure tests and visual proof. Move print composition and colorway assets to the commerce owner. | Do not merge the branch or backend wholesale. Reject the `/shop` route, Shopify/Gooten/order code in viewer core, optional authentication, unbounded body collection, UI-selector color injection, production-site dependency, hard-coded browser user agent, silent viewer-state omission, and responses that return PNG bytes for requests named JPEG, WebP, GLB, or USDZ. |

The small PR 242 correctness and cleanup fixes are independent of the P2
performance experiment and should not wait for culling benchmarks. Conversely,
the historical culling algorithm must not be smuggled in as part of those small
fixes.

Candidate recovery status: Plan 024 reimplemented the relevant PR 242 behavior
against the current renderer (explicit bounded DPR/sRGB/no-tone configuration,
clearcoat synchronization, replacement disposal, and conservative dynamic atom
bounds) without importing the historical commit or its competing ACES owner.
No `shop-route` commerce/backend code was imported; only its executor lessons
inform the future Plan 026 boundary. These are source-state statements, not a
merge, deploy, or public-release claim.

## Browser and edge capabilities

The browser and edge manifests are intentionally different contracts.

| Capability              | Browser viewer V1 candidate                                                                                                                                                             | Cloudflare edge                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Runtime                 | Mounted WebGL viewer with an active, fully decoded frame                                                                                                                                | Browser-free Worker control plane                                                                                          |
| Tool surface            | 28-tool browser manifest and viewer-control bridge                                                                                                                                      | Six outcome-oriented MCP tools plus REST compatibility routes                                                              |
| V1 execution            | Executes locally in the browser                                                                                                                                                         | **Validation only**; always returns `awaiting_renderer` and withholds renderer/artifact/job/cache identities               |
| Raster formats          | PNG and WebP with opaque or transparent alpha; JPEG opaque only; exact dimensions 64-4096                                                                                               | Opaque PNG only in the advertised submission capability; no V1 pixel executor exists                                       |
| Model formats           | Deterministic GLB with `alpha: 'not-applicable'`; raster dimensions and `transparent` are rejected. USDZ is disabled in the immutable-key lane because Three r184 embeds process-global ids. | Unsupported                                                                                                                |
| Applied raster pipeline | Raw Three.js scene, pixel ratio 1, sRGB output, no renderer tone mapping or interactive postprocess, plus the versioned canvas axes overlay when enabled                                | Declared in the accepted V1 spec, but not executed                                                                         |
| Backgrounds             | Opaque raster requires a canonical gradient that capture applies directly; image, video, procedural, and backdrop-mesh backgrounds fail closed. Transparent raster disables background. | Background layer is unsupported in the initial V1 profile                                                                  |
| Bonds                   | Model export may use the synchronous CPU export path. Deterministic raster bonds fail closed because the live asynchronous bond result is not snapshot-addressable.                     | Unsupported                                                                                                                |
| Delivery                | Inline base64/data URL or user download; no durable ownership is implied                                                                                                                | V1 has no job/storage/retrieval path until Plan 026; legacy-v0 compatibility may still use existing queue/HTTP/R2/D1 paths |

Browser support does not automatically confer edge support. Edge support does
not exist because a format appears in a schema. The selected executor must
advertise the exact format, alpha, layer, color, and tone policies it implements,
and the edge must reject a mismatch before enqueueing work.

## Contract objects

Contract V1 has three nested objects. `RenderRequestV1` carries a submission
spec plus transport preferences. `RenderArtifactSpecV1` is the finalized form
of that spec after its source is content-addressed. `RenderDeliveryV1` contains
only response/transport preferences and never participates in identity. Runtime
capability and renderer fingerprint are separate objects.

### RenderRequest

```ts
interface RenderRequestV1 {
  version: "lupi.render-request.v1";
  spec: RenderRequestSpecV1;
  delivery: RenderDeliveryV1;
}
```

`RenderRequestSpecV1` may contain either a `{ kind: 'reference', uri, revision? }`
source or a finalized `{ kind: 'content', mediaType, contentDigest }` source.
Only the latter can become a `RenderArtifactSpecV1` and receive a `specId`.
Authentication, ownership, billing, retry state, consumer correlation, and
request IDs belong to an outer operational envelope; they are not semantic
render inputs.

The compiler resolves aliases, source URLs, defaults, frame selection, and
viewer patches. It rejects unknown or unsupported fields. It must not silently
replace an unavailable molecule, frame, layer, or format with a default.

### RenderArtifactSpec

```ts
interface RenderArtifactSpecV1 {
  version: "lupi.render-artifact-spec.v1";
  source: {
    kind: "content";
    mediaType: string;
    contentDigest: `sha256:${string}`;
  };
  format: "png" | "jpeg" | "webp" | "glb" | "usdz";
  width?: number; // required for raster, forbidden for model
  height?: number; // required for raster, forbidden for model
  alpha: "opaque" | "transparent" | "not-applicable";
  frame: number;
  layers: Record<RenderLayerIdV1, boolean>;
  view: CanonicalAppliedViewV1;
}
```

Every applied default is materialized before canonicalization. `view` contains
exact keys for the selected format and enabled layers; unknown or ignored
fields fail. Raster `view` always includes canonical camera position, target,
FOV, near plane, far plane, lighting, and the
fixed raw-scene postprocess projection. Maps use sorted keys and non-finite
numbers, ambient locale, wall-clock time, and randomness are forbidden. Model
formats omit raster camera/lighting/postprocess and dimensions and use
`alpha: 'not-applicable'`.

### RenderDelivery

```ts
interface RenderDeliveryV1 {
  version: "lupi.render-delivery.v1";
  inline: boolean;
  maxInlineBytes: number;
  sync: boolean;
  filename?: string;
}
```

Changing delivery preferences does not change `requestKey`, `specId`, renderer
fingerprint, `artifactKey`, or `artifactDigest`. Job status, retrieval URL,
authorization, expiry, owner ID, and cache-hit state belong to an operational
response owned by Plan 020/026; they are deliberately not modeled as semantic
artifact fields here.

## Identity separation

The four identifiers answer different questions and must never be aliased:

| Field                 | Meaning                                                               | Derivation                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specId`              | What exact semantic render was requested?                             | `spec-sha256:` plus SHA-256 of canonical `RenderArtifactSpecV1`                                                                                                      |
| `rendererFingerprint` | What renderer execution equivalence class actually ran?               | `renderer-sha256:` plus SHA-256 of exact renderer/build IDs, execution class, runtime facts, deterministic flags/encoders/color ownership, and advertised capability |
| `artifactKey`         | Immutable cache/object identity for this spec on this execution class | `artifact-sha256:` plus SHA-256 of canonical `{ version: 'lupi.render-artifact-key.v1', specId, rendererFingerprint }`                                               |
| `artifactDigest`      | What exact decoded bytes were produced?                               | `sha256:` plus SHA-256 over artifact bytes, recomputed by the receiving trust boundary                                                                               |

`artifactKey` is an identity, not a mutable storage locator and not a synonym
for the byte digest. A storage path may be derived from it, but storage layout
is outside this contract. First write to an `artifactKey` is immutable: the same
byte digest is idempotent, while a different digest is a determinism conflict
that must be quarantined or failed, never overwritten.

The browser adapter uses `VITE_LUPI_BUILD_SHA` as an exact 40-hex Git SHA for a
production build and verifies it against the checked-out build source. A
development build without that value uses the explicit
`non-durable-development` identity. Artifacts created under that identity are
local candidates and must not seed a durable cross-release cache or a release
provenance claim.

The legacy edge `assetId` is a hash of its own normalized compatibility request.
It is neither a V1 `specId` nor proof of `artifactDigest`; it must remain visibly
namespaced as `legacy-v0` rather than being upgraded by relabeling.

## Format and byte-validation rules

The receiver decodes base64 once, applies a configured maximum before storage,
and validates the bytes independently of renderer-declared metadata.

| Format | Required MIME and structure                                                        | Browser V1 candidate           | Edge RenderRequestV1                                       |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| PNG    | `image/png`; PNG signature, valid IHDR/decode, exact dimensions                    | Opaque or verified transparent | Accepts opaque atom-only spec for validation; no execution |
| JPEG   | `image/jpeg`; valid JPEG structure and exact dimensions                            | Opaque only                    | Unsupported                                                |
| WebP   | `image/webp`; RIFF/WEBP with VP8/VP8L/VP8X and exact dimensions                    | Opaque or verified transparent | Unsupported                                                |
| GLB    | `model/gltf-binary`; `glTF` magic, exact declared length, valid chunks/scene       | `not-applicable`               | Unsupported                                                |
| USDZ   | `model/vnd.usdz+zip`; aligned stored ZIP entries and readable USDA scene/materials | Disabled: stock exporter is not byte-deterministic for one artifact key | Unsupported                                                |

The extension, requested format, detected structure, and MIME type must agree.
There is no implicit transcoding or relabeling. Declared `byteLength` and digest
must match independently recomputed values. Returned `jobId`, `specId`, and any
renderer-visible request identity must match the dispatched work. A mismatch is
a failed job and no bytes are persisted.

Video remains outside v1 because duration, frame cadence, codec, camera path,
and browser encoder variability need their own canonical specification.

## Alpha, color, and tone policy

### Alpha

- `opaque` requires an opaque raster result. Formats without alpha satisfy this
  only when the specification also rejects transparency.
- `transparent` requires straight, non-premultiplied output alpha, at least one
  non-transparent content pixel, and at least one transparent pixel when the
  rendered bounds do not fill the frame.
- Clearing the WebGL canvas alpha is not proof of transparency. Scene
  background textures, environment domes, procedural backdrops, fog, ground,
  shadows, filter shells, and postprocess passes remain visible layers unless
  the specification includes or suppresses them explicitly.
- Dual-pass difference matting from `shop-route` is fallback design evidence,
  not an accepted implementation. Prefer a direct render path that disables
  undeclared opaque layers; if matting is retained, solve in the declared
  linear color space and prove edge quality with fixtures.

### Color

- The current browser V1 raster profile fixes `outputColorSpace: 'srgb'` in
  `view.postprocess`; the renderer fingerprint also records this ownership.
- Encoder/browser engine revisions which may change emitted bytes belong in the
  renderer fingerprint. A future profile must version any different transfer,
  primaries, or embedded-profile policy instead of silently changing V1.
- Model material colors and texture color spaces must be declared separately
  from raster output color. A renderer must not infer color behavior from file
  extension alone.
- A browser, image library, or provider adapter must not silently recolor,
  premultiply, strip a profile, or apply an undeclared colorway.

### Tone

- Browser V1 export fixes `pipeline: 'raw-scene'`, `toneMapping: 'none'`, and
  `multisampling: 0`. Capture bypasses the interactive EffectComposer and
  renders the raw Three.js scene exactly once.
- Interactive postprocess presets are therefore not silently represented as
  exported pixels. A future postprocessed artifact profile needs its own
  canonical fields, renderer fingerprint, structural tests, and visual proof.

## Visible-layer fail-closed rule

`layers` exhaustively names every known layer that can affect pixels or model
contents. V1 currently permits canonical state for background, atoms, vector
glyphs, bonds, simulation cell, filter shell, molecule shadow, contact shadows,
and axes. Atom clusters, ghost atoms, annotations, knowledge labels, selection
markers, atom trails, and scale bar are registered as unsupported and fail when
enabled. Runtime adapters may narrow this registry further; browser raster
bonds and edge V1 background/bonds are examples.

The current browser adapter snapshots canonical state and rejects unsupported
active state before capture. A future remote executor must additionally return
the requested and applied projections plus an applied-projection digest. Any
executor fails before completion when:

- a requested layer or setting is unsupported, unknown, or silently ignored;
- a layer is visible but absent from the specification;
- a source-semantic layer is requested without source evidence;
- transparency conflicts with a requested opaque background or effect;
- asynchronous loading leaves a requested layer unresolved at capture time; or
- the applied-layer projection differs from the canonical specification.

An inferred bond result that reaches its cap is unresolved, not a successful
lower-quality artifact. The immutable lane fails rather than returning a model
whose spec claims the complete `covalent-inference-v1` layer. Likewise, raster
capture freezes the addressed integer MD frame; a stale fractional playback
state cannot be emitted under that frame's identity.

Warnings may describe quality or performance, but they cannot downgrade a
contract violation into success. Falling back to caffeine, frame zero, a
default camera, a default colorway, hidden bonds, or PNG is forbidden after the
specification has been compiled.

## Provenance sidecar

This is the required durable target, not a claim about the current browser or
edge implementation. Plan 024 browser responses expose the four artifact
identities with bytes; Plan 020/026 still own a persisted immutable JSON
sidecar, storage readback, authenticated retrieval, and cache-conflict proof.
No current V1 edge request produces or stores a sidecar. A future sidecar must
contain no bearer token, API key, signed URL, email address, or delivery secret.

Required sidecar fields are:

- sidecar schema version, `specId`, `rendererFingerprint`, `artifactDigest`,
  `artifactKey`, sidecar digest, format, MIME, byte length, and dimensions;
- the complete canonical `RenderArtifactSpec`;
- molecule source media type, content and frame digests, units, atom count,
  source locator or dataset identifier when publishable, license/citation when
  known, and transformations applied before rendering;
- exact repository Git SHA, viewer and bridge versions, renderer build or
  container digest, encoder/library versions, runtime/browser version, render
  backend, relevant flags, fonts, and visual-asset pack digests;
- requested and applied visible-layer projections, camera, alpha, color, and
  tone policies;
- validation receipts for structure, MIME, length, digest, alpha, dimensions,
  visible layers, and R2 or equivalent storage readback; and
- creation time, owner or service principal identifier, consumer kind, and any
  non-conformance-free warnings.

The sidecar is itself digested. Consumers verify the sidecar digest and
artifact digest before use. Provenance can point to separately access-controlled
source evidence; it must never copy secrets into a public artifact.

## Compatibility and deprecation

- Unknown contract major versions fail closed. Optional additive fields require
  a declared minor-version rule; unknown semantic fields do not silently enter
  canonicalization.
- Any change to defaults, canonicalization, visible-layer meaning, renderer
  policy, format semantics, color, tone, or alpha behavior creates a new policy
  or contract version and therefore a new `specId` or `fingerprint`.
- Renderer capability discovery names the contract versions and exact profiles
  it supports. The edge chooses only a compatible profile and never retries an
  unsupported request as a different format.
- Deprecation names the replacement, the first release carrying it, and a
  not-before removal release or date. A version remains readable until every
  registered first-party commerce and research consumer has migration evidence.
- Immutable artifacts and sidecars are never rewritten during migration. New
  behavior creates a new specification and new artifact. Retention or deletion
  is a separately documented storage policy keyed by digest.
- The existing `legacy-v0` edge queue/HTTP/R2/D1 flow remains a compatibility
  profile during adoption. Its normalized request hash and `assetId` are not V1
  `specId`, `artifactKey`, or `artifactDigest`; no legacy completion may be
  described as V1-conforming.

## Consumer boundaries

Lupi emits rendered artifacts and provenance. Consumers do not own or reach
into viewer internals.

| Consumer | May consume                                                                                                                                                                 | Must remain outside Lupi viewer core                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Commerce | Versioned artifact bytes, provenance, permitted crops/compositions, and a separately versioned downstream print-composition artifact that cites the source `artifactDigest` | Shopify, Gooten, products, SKUs, pricing, orders, checkout, fulfillment, provider credentials, and provider-specific templates or retries |
| Research | Versioned rendered evidence and provenance tied to source/frame digests                                                                                                     | Experiment scheduling, cloud runners, model training, benchmarks, promotion policy, and scientific claims not supplied by source evidence |

Consumer-specific layout, SKU, order, campaign, or experiment metadata belongs
in consumer delivery records. If a downstream crop, montage, label, or print
composition changes bytes, it is a new artifact with its own digest and
sidecar referencing the Lupi source artifact. A storefront or research system
must not mutate bytes while continuing to cite the original digest.

## Acceptance and evidence lanes

A conforming implementation needs focused fixtures for every supported format,
alpha mode, layer policy, and rejection path. The minimum end-to-end PNG proof
is authenticated request, canonical spec, executor handoff, validated bytes,
immutable persistence, storage readback, provenance verification, authorized
retrieval, and deterministic cache hit for the same
`(specId, rendererFingerprint)`.

This document does not authorize infrastructure changes or a production
release. Current evidence lanes are deliberately independent:

| Truth lane  | Status          | Evidence or missing proof                                                                                                                                                     |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local       | **PASS**        | The Plan 024 worktree passed the full bounded local matrix and the repository owner approved the pinned browser golden; clean exact-SHA CI derivation remains a separate pending lane. |
| CI          | **NOT CHECKED** | No exact-SHA GitHub Actions result has been recorded for this Plan 024 candidate.                                                                                             |
| Deploy      | **NOT CHECKED** | No Plan 024 Worker/viewer revision, renderer, binding, secret, queue, bucket, or database change was deployed.                                                                |
| Live API    | **NOT CHECKED** | No deployed V1 render execution, retrieval, provenance, or immutable cache-hit path exists; edge V1 remains validation-only.                                                  |
| Public site | **NOT CHECKED** | No exact-revision or `https://lupi.live` browser conformance receipt has been recorded for this candidate.                                                                    |

These statuses remain independent. Source presence, a passing unit test, a
renderer upload, or plausible bytes in one lane never establishes another lane.
