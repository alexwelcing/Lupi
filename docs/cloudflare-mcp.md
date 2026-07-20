# Cloudflare MCP control plane

This is the MCP portion of the broader Cloudflare app migration. The Worker in
`apps/mcp-worker` serves the built web app and dynamic edge routes, but render
truth currently has two explicitly different profiles. See
`docs/cloudflare-migration.md` for the whole-app routing design and
`docs/render-artifact-contract.md` for artifact identity and provenance rules.

## Current route surface

- `GET /` - built Lupi web app from `apps/web/dist`
- `GET /view/:slug` - saved-view social/share HTML
- `POST /collectAnalytics` - first-party analytics collector
- `GET /__/auth/*` and `/__/firebase/*` - Firebase reserved-path proxy
- `POST /mcp` - MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`)
- `GET /health` - service, release-metadata, binding, and render-profile status
- `GET /mcp-manifest.json` - six-tool browser-free edge manifest
- `GET /browser-mcp-manifest.json` - 28-tool browser-viewer manifest
- `POST /v1/render` - REST shortcut for `lupi.render_molecule_asset`
- `GET /v1/jobs/:jobId` and `GET /assets/:assetId.:ext` - legacy-v0
  job/asset compatibility routes

Static web assets and SPA navigation remain asset-first. Worker code runs first
only for the dynamic patterns in `wrangler.toml`. Dynamic responses carry
`x-lupi-edge-executed: 1`; browser manifest, SPA HTML, and fingerprinted Vite
assets do not. Hashed Vite `/assets/index-*` files must never be captured by a
broad Worker-first `/assets/*` rule.

## Render profiles: do not conflate them

| Profile           | Intake                                                                                                         | Execution and storage                                                                                                                                  | Identity truth                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RenderRequestV1` | Strict shared `lupi.render-request.v1` document; edge capability is opaque PNG, atoms only, 64-4096 dimensions | **Validation only.** Returns `awaiting_renderer` with `renderer.mode: 'contract-only'` and `configured: false`, regardless of legacy renderer bindings | May return `requestKey`; may return `specId` only for a content-addressed source. It intentionally withholds renderer fingerprint, `artifactKey`, job/cache/asset identities, and bytes |
| `legacy-v0`       | Historical `{ molecule, asset, viewer, ... }` arguments                                                        | Existing R2/D1 lookup, queue handoff, or HTTP renderer compatibility path may run when configured                                                      | Historical `assetId`, `cacheKey`, and `sha256` fields are not V1 `specId`, `artifactKey`, or `artifactDigest` and must not be described as V1-conforming                                |

The Worker is browser-free. A Queue or `RENDERER_ENDPOINT` binding can make
`legacy-v0` executable, but it does not activate V1. Plan 026 owns an
authenticated, bounded V1 renderer-and-retrieve path and the activated renderer
fingerprint. Until then, V1 never pretends to produce pixels.

`GET /health` reports these states independently:

```json
{
  "renderProfiles": {
    "legacyV0": { "execution": false, "compatibilityOnly": true },
    "renderRequestV1": { "execution": false, "validationOnly": true }
  }
}
```

`legacyV0.execution` may become `true` when a legacy queue or endpoint binding
exists. `renderRequestV1.execution` remains `false` in the current source.
The older top-level `renderExecution` field is a legacy binding aggregate; use
the per-profile fields when deciding whether V1 can execute.

## Run locally

```bash
pnpm cloudflare:build
pnpm cloudflare:test
pnpm cloudflare:dev
```

The dev server usually prints a URL such as `http://127.0.0.1:8787`.

List the edge tools:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The manifest's `lupi.render_molecule_asset` schema is the authoritative V1
request example because it includes the full exact-key camera, lighting,
raw-scene postprocess, atom, layer, source, and delivery shapes:

```bash
curl -s http://127.0.0.1:8787/mcp-manifest.json
```

Contract version strings use dots, exactly as the runtime does:

- `lupi.render-request.v1`
- `lupi.render-artifact-spec.v1`
- `lupi.render-delivery.v1`
- `lupi.render-capability.v1`

An unresolved `{ kind: 'reference', uri, revision? }` source can receive only a
request key. A `{ kind: 'content', mediaType, contentDigest }` source can also
receive a `specId`. Neither form can receive an `artifactKey` before an
activated executor contributes a verified `rendererFingerprint`.

## Authentication

The edge keeps the public status/search/manifest tools readable. Render, job,
and asset MCP tool calls require the configured bearer secret. This is current
edge-envelope behavior, not proof that a V1 renderer or retrieval path exists.
Plan 019 owns broader untrusted-envelope limits; Plan 026 owns production V1
renderer authentication and authorization.

## Tool set

- `lupi.status`
- `lupi.search_molecules`
- `lupi.render_molecule_asset`
- `lupi.get_render_job`
- `lupi.get_asset`
- `lupi.viewer_manifest`

The browser manifest intentionally remains a separate 28-tool interactive
surface. A shared render specification does not imply a shared tool inventory.

## Resource shape and authorization boundary

The repository contains binding contracts for R2, D1, Queue, and an optional
HTTP renderer. Creating resources, setting secrets, deploying, or enabling a
renderer is an infrastructure mutation and is not authorized by Plan 024.
The commands and example payloads formerly documented here described the
legacy-v0 path only; they are intentionally omitted so they cannot be mistaken
for a V1 launch procedure.

## Evidence lanes

| Truth lane  | Current status                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Local       | **PASS** - the bounded Plan 024 local matrix passed and the repository owner approved the pinned browser golden; exact-SHA CI remains separate |
| CI          | **NOT CHECKED** - no exact-SHA Plan 024 CI receipt is recorded                                                                                  |
| Deploy      | **NOT CHECKED** - no Plan 024 Worker, binding, secret, queue, bucket, database, or renderer was deployed                                        |
| Live API    | **NOT CHECKED** - no deployed V1 execution/retrieval/cache path was exercised                                                                   |
| Public site | **NOT CHECKED** - no exact-revision or `https://lupi.live` Plan 024 browser receipt was recorded                                                |

These lanes never imply one another. Source presence or a local Worker test is
not deployment evidence; a configured legacy renderer is not V1 execution.

## Next owner

Plan 020 owns immutable cache completion, object/range retrieval, and durable
sidecars. Plan 026 owns the authenticated V1 browser executor, runtime
fingerprint activation, output validation, readback, and golden render/retrieve
proof. Any widening beyond opaque PNG atoms must follow executor evidence rather
than schema aspiration.
