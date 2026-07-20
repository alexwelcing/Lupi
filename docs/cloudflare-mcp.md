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
- `POST /v1/render` - authenticated render submission
- `GET /v1/jobs/:jobId` - authenticated job receipt
- `GET|HEAD /v1/jobs/:jobId/provenance` - authenticated per-job provenance
- `GET|HEAD /v1/artifacts/:assetId.png` - authenticated private artifact bytes

Static web assets and SPA navigation remain asset-first. Worker code runs first
only for the dynamic patterns in `wrangler.toml`. Dynamic responses carry
`x-lupi-edge-executed: 1`; browser manifest, SPA HTML, and fingerprinted Vite
assets do not. Hashed Vite `/assets/index-*` files must never be captured by a
broad Worker-first `/assets/*` rule.

## Render profiles: do not conflate them

| Profile           | Intake                                                                                                         | Execution and storage                                                                                                                                  | Identity truth                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RenderRequestV1` | Strict shared `lupi.render-request.v1` document; edge capability is opaque PNG, atoms only, 64-4096 dimensions | **Validation only.** Returns `awaiting_renderer` with `renderer.mode: 'contract-only'` and `configured: false`, regardless of legacy renderer bindings | May return `requestKey`; may return `specId` only for a content-addressed source. It intentionally withholds renderer fingerprint, `artifactKey`, job/cache/asset identities, and bytes |
| `legacy-v0`       | Strict subset of historical `{ molecule, asset, viewer, ... }` arguments: template or bounded procedural input, synchronous opaque PNG, and no viewer overrides | Authenticated HTTP handoff to one co-built browser lane; private R2 job, provenance, and artifact persistence; authenticated readback | The byte-derived `assetId` and legacy provenance are operational receipts. They are not V1 `specId`, `rendererFingerprint`, `artifactKey`, or a V1-conformance claim |

The Worker is browser-free. The first real remote execution lane is intentionally
small and remains named `legacy-v0`: it delegates to a separately authenticated,
co-built browser renderer and stores the validated result in private R2. That
lane does not activate V1. A V1 executor still needs source resolution, exact
spec application, an activated renderer fingerprint, V1 sidecars, and
`artifactKey` cache-conflict proof. Until then, V1 never pretends to produce
pixels.

`GET /health` reports these states independently:

```json
{
  "renderProfiles": {
    "legacyV0": { "execution": false, "compatibilityOnly": true },
    "renderRequestV1": { "execution": false, "validationOnly": true }
  }
}
```

`legacyV0.execution` becomes `true` only when caller authentication, the private
`RENDER_ASSETS` bucket, `RENDERER_ENDPOINT`, and renderer-to-edge authentication
are all configured. A Queue or public asset bucket is not sufficient.
`renderRequestV1.execution` remains `false`. Use the per-profile fields when
deciding whether any request can execute.

## Executable legacy-v0 profile

The authenticated lane is deliberately narrower than the historical schema:

- `molecule.inputType` is `template` or `procedural` only;
- template requests reject procedural fields;
- procedural requests allow 1 through 100,000 atoms, `sc`, `bcc`, or `fcc`
  lattices, element symbols, and spacing from 0.1 through 20 source units;
- output is synchronous, opaque `image/png` only, from 64 through 2048 pixels
  in each dimension;
- `viewer` must be absent or empty; no setting may be accepted and silently
  ignored;
- request JSON is capped at 256 KiB, the renderer deadline is 90 seconds, and
  the encoded renderer response is capped at 32 MiB.

The edge independently checks the renderer protocol and job identity, canonical
base64, byte length, PNG signature/chunks/CRC, exact dimensions, and the bounded
opaque RGB8 profile. It recomputes the byte digest, uses a create-only private
R2 write, reads the bytes back, and only then records `complete`. The per-job
provenance receipt records those checks and the browser receipt as provenance;
it does not upgrade the result to V1.

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
provenance, and artifact calls fail closed unless the caller supplies:

```http
Authorization: Bearer <LUPI_MCP_SHARED_SECRET>
```

`LUPI_MCP_SHARED_SECRET` authenticates the agent to the edge.
`RENDERER_TOKEN` is a different secret used only from the edge to
`RENDERER_ENDPOINT`; callers must never receive it. Missing authentication or
private-render configuration is an unavailable service, not an anonymous
fallback. This authenticated legacy envelope is not proof that a V1 renderer
or retrieval path exists.

Example bounded request:

```bash
curl -s https://lupi.live/v1/render \
  -H "authorization: Bearer $LUPI_MCP_SHARED_SECRET" \
  -H 'content-type: application/json' \
  -d '{
    "molecule":{"inputType":"procedural","input":"5k copper fcc","atomCount":5000,"element":"Cu","lattice":"fcc"},
    "asset":{"format":"png","width":1024,"height":1024,"transparent":false},
    "sync":true
  }'
```

The completed response includes relative job, provenance, and artifact URLs.
Send the same caller bearer token when following any of them; R2 is never a
public retrieval surface.

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

Two R2 responsibilities must stay separate:

- `ASSETS` / `lupi-assets` serves public gallery and application assets.
- `RENDER_ASSETS` uses `lupi-render-artifacts` in production and
  `lupi-render-artifacts-preview` in preview. Neither bucket may have an
  `r2.dev` endpoint or public custom domain. Only authenticated Worker routes
  may read it.

The executable lane also requires the non-secret HTTPS `RENDERER_ENDPOINT`
configuration plus both secrets described above. Plain HTTP is permitted only
for a localhost renderer. D1 and Queue are not part of this first synchronous
lane; job receipts, per-job provenance, and immutable PNG bytes live under
separate private R2 prefixes.

Provisioning either private bucket, setting secrets, deploying the renderer,
or enabling production execution is an infrastructure action. None of those
actions activates `RenderRequestV1`.

## Evidence lanes

| Truth lane  | Current status                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Local       | **PASS** - the bounded Plan 024 local matrix passed and the repository owner approved the pinned browser golden; exact-SHA CI remains separate |
| CI          | **NOT CHECKED** - no exact-SHA Plan 024 CI receipt is recorded                                                                                  |
| Deploy      | **NOT CHECKED** - the private render binding is named in source, but bucket provisioning, secrets, renderer deployment, and the exact Worker release are not proven |
| Live API    | **NOT CHECKED** - neither the authenticated legacy render/retrieve loop nor V1 execution has been proven live                                   |
| Public site | **NOT CHECKED** - no exact-revision or `https://lupi.live` Plan 024 browser receipt was recorded                                                |

These lanes never imply one another. Source presence or a local Worker test is
not deployment evidence; a configured legacy renderer is not V1 execution.

## Next owner

The bounded legacy lane supplies one real authenticated render/job/provenance/
artifact loop without borrowing V1 names. V1 still requires source resolution,
an exact spec-applier, runtime fingerprint activation, V1 provenance, and a
golden render/retrieve/cache-conflict proof. Any widening beyond the current
template/procedural opaque-PNG profile must follow executor evidence rather than
schema aspiration.
