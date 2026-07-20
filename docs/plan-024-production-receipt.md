# Plan 024 recovery production receipt

Receipt date: 2026-07-20

Runtime release target: `f94c8049db4fea5a1a84815e44d2a9564f740700`

This receipt closes the ownership-first recovery release without collapsing
local, CI, deployment, live API, and public-site evidence into one claim.
`RenderRequestV1` remains validation-only; the production executor is the
separately named authenticated `legacy-v0` opaque-PNG profile.

## Local truth

- The Plan 024 browser golden remained byte-identical across 10 captures:
  `sha256:be58c627886d76effc7aa23edf8e1910f51f69ce5ef778601738829bdf8ecbd3`.
- The consolidated end-of-development pass completed: 10/10 workspace builds,
  19/19 workspace test tasks, 434 UI tests, 141 parser tests, 78 scene tests,
  76 core tests, 48 Worker tests, 16 backend tests, and lint with zero errors.
- Browser MCP verification passed 17/17 and asset-quality verification passed
  187/187.
- The exact backend Water/64x64 request completed locally in 5.6 seconds after
  the capture lane was made no-HDRI and WebGL/SwiftShader deterministic.

Local artifacts:

- `.verify-artifacts/mcp-bridge/2026-07-20T21-02-22-148Z-report.json`
- `.verify-artifacts/asset-quality/2026-07-20T21-06-34-648Z/report.json`
- `.verify-artifacts/render-parity/2026-07-20T21-10-19-602Z/report.json`

## CI truth

- Exact-release CI: [GitHub Actions run 29783685616](https://github.com/alexwelcing/Lupi/actions/runs/29783685616) passed, including workflow contracts, product contract, lint, builds, workspace tests, Worker tests, catalog drift, and production UI.
- Exact-release renderer deployment: [GitHub Actions run 29783685609](https://github.com/alexwelcing/Lupi/actions/runs/29783685609) passed.

## Deployment truth

- Cloudflare Worker version `27994724-5625-46a7-acb8-a150aab5cdd5`, tagged
  with the release target, receives 100% traffic.
- Cloud Build `5f76b720-e5f8-4b92-8806-e5705bbd92d2` produced immutable image
  digest `sha256:b9c9bc6831de5c7acef8dadd62b915454f6991a12a98aeb4129efdaf17e05e86`.
- Cloud Run revision `lupi-render-backend-00006-kow`, labeled with the release
  target, is Ready and Active and receives 100% traffic.
- Production and preview render buckets are private. The Worker has the private
  render binding plus distinct caller and renderer credentials; values are not
  recorded here.

## Live API truth

The custom-domain check used `https://lupi.live` and the bounded request
`Water`, opaque PNG, 64x64, synchronous, non-inline.

- Credential-free `POST /v1/render`: HTTP 401.
- Authenticated `POST /v1/render`: HTTP 200 in 12.5 seconds.
- Job: `job-v0-a43ad84e-d5fd-4e97-b74f-ec1449120d71` (`complete`).
- Asset: `sha256-23eed044cc36ce1b88da5b6a1a933bdbe3d543d362885ce25ebfc10bcb64c81b`.
- Artifact digest: `sha256:23eed044cc36ce1b88da5b6a1a933bdbe3d543d362885ce25ebfc10bcb64c81b`.
- Provenance digest: `sha256:f35be66470f81a5079154ba56dd9478d099e83813acf786123e824d62bffb8ef`.
- Retrieved PNG was 435 bytes, had a valid PNG signature, and matched the asset
  ID and response digest byte-for-byte.
- Job, provenance, and artifact retrieval all required the caller credential.
  Artifact response was `private, no-store`, `nosniff`, and content-addressed by
  ETag.
- `/health` reported authenticated legacy-v0 execution true and
  `RenderRequestV1` execution false.

## Public-site truth

The exact Worker release served the public application at `https://lupi.live`.
A real Chromium check proved:

- viewer bridge ready with 28 browser tools;
- Water loaded as three atoms;
- a non-zero R3F canvas was mounted at the public route;
- release ID and tag matched the Worker version and runtime release target.

The broader deployed browser bridge pass also exercised molecule generation,
deterministic raster export, camera/material/background controls, URL encoding,
and postMessage execution successfully.

## Historical and branch disposition

- All `alexwelcing/Lupi` pull requests are closed or merged. PRs 39, 40, and 30
  were superseded; PR 29 remains a commerce-design source, not viewer code.
- PR 44 selectively recovered 236 pixel-identical image optimizations, saving
  18,835,688 bytes while retaining the newer high-resolution sphere image.
- Original `alexwelcing/lupine` PRs 208, 236, 185, 227, 225, and 238 should not
  be imported into Lupi: they are respectively stale viewer cleanup, commerce,
  research control-plane work, Lupine Start work, non-viewer SVG work, and
  line-ending hygiene.

## Focused recovery backlog

1. Implement shared triclinic minimum-image and unwrapping semantics across
   interpolation, bonds, vector glyphs, and measurements. Current parsers retain
   `boxTilt`/`triclinic`, but visible geometry remains orthorhombic.
2. Rebuild the lost human per-type hide/solo/scale/reset controls and annotation
   style/list/clear controls in current `MoleculeControls` and Study Lens. The
   store, renderer, export, and four annotation styles already exist; do not
   restore the deleted `VisualsPanel` wholesale.
3. Extend measurement work with dihedrals, multiple pinned measurements,
   history/CSV, and source-content drift detection.
4. Replace the owner-operated shared caller secret with scoped user API keys,
   owner IDs on jobs/assets, quotas, revocation, and authenticated or signed
   retrieval before multi-user or paid execution.
5. Build the real V1 source resolver, exact spec applier, runtime fingerprint,
   V1 provenance, deterministic cache hit, and cache-conflict proof. Do not
   rename the legacy executor into V1.
6. Profile before pursuing GPU-direct bond generation or a WebGPU backend.
   WebGPU changes interact with Three.js postprocessing, XR, and export
   readback; the immutable PNG lane should stay on its proven WebGL path.
7. Measure current adaptive DPR/frustum behavior and resolve the React 19,
   R3F 9, Three 0.184, postprocessing, and `r3f-perf` peer-version debt.
8. Recover historical research assets only through versioned, provenance-aware
   ingestion: the three Cu MD showcases moved by `0b241d69`, and the expanded
   910-node/1,789-edge sphere graph from `wip/sphere-grid-assets-2026-07-11`.
   Do not restore hard-coded research endpoints or stale root assets.

