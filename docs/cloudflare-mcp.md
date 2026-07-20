# Cloudflare MCP Control Plane

This is the MCP portion of the broader Cloudflare app migration. The same
Worker now serves the built web app, Firebase auth reserved-path proxy,
analytics collection, saved-view social HTML, and the agent-native MCP service.
See `docs/cloudflare-migration.md` for the whole-app cutover.

## What Exists Now

The Cloudflare edge app is `apps/mcp-worker`.

It provides:

- Workers static asset hosting for `apps/web/dist`.
- Firebase reserved-path proxying for `/__/auth/*` and `/__/firebase/*`.
- Edge analytics at `/collectAnalytics`.
- Saved-view social HTML at `/view/:slug`.
- `POST /mcp` — MCP JSON-RPC over HTTP (`initialize`, `tools/list`, `tools/call`).
- `GET /health` — readiness and binding status.
- `GET /mcp-manifest.json` — six-tool edge control-plane manifest for the
  browser-free Worker runtime.
- `GET /browser-mcp-manifest.json` — 28-tool browser viewer manifest served
  from the built web assets for browser-bridge clients and verification.
- `POST /v1/render` — REST shortcut for `lupi.render_molecule_asset`.
- `GET /v1/jobs/:jobId` — render job status.
- `GET /assets/:assetId.:ext` — R2 asset delivery when `ASSETS` is bound.

The worker does not pretend Cloudflare can render WebGL by itself. It owns the
control plane: validation, deterministic cache keys, R2/D1/Queue contracts, and
optional renderer-backend handoff.

The two MCP manifests are intentionally different. Do not compare the browser
bridge's viewer registry with `/mcp-manifest.json`; browser clients use
`/browser-mcp-manifest.json`, while edge clients use `/mcp-manifest.json`.

Static web assets and SPA navigation are asset-first. Worker code runs first
only for the explicit dynamic route patterns in `wrangler.toml`: health, MCP,
render/job/asset APIs, analytics, Firebase reserved paths, saved-view share
HTML, and the R2-backed gallery allowlist. Hashed Vite `/assets/index-*` files
must never be covered by a broad `/assets/*` Worker-first rule.
Dynamic responses carry `x-lupi-edge-executed: 1`; the browser manifest, SPA
HTML, and fingerprinted Vite assets must not. Fingerprinted `/assets/*` files
receive a one-year immutable browser-cache policy from `apps/web/public/_headers`.

## Run Locally

```bash
pnpm cloudflare:build
pnpm cloudflare:test
pnpm cloudflare:dev
```

The dev server usually prints a local URL such as `http://127.0.0.1:8787`.

List tools:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Submit a render request:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":"render-caffeine",
    "method":"tools/call",
    "params": {
      "name":"lupi.render_molecule_asset",
      "arguments": {
        "molecule": { "inputType":"template", "input":"Caffeine" },
        "asset": { "format":"png", "width":1024, "height":1024 },
        "viewer": { "showBonds":true, "cameraPreset":"iso", "postprocessPreset":"studio" }
      }
    }
  }'
```

Without `RENDER_QUEUE` or `RENDERER_ENDPOINT`, the response is a deterministic
`awaiting_renderer` job. That is intentional: it lets agents prove the cloud
contract without launching Chromium, while making missing render infrastructure
explicit.

## Deploy Shape

Create Cloudflare resources per environment:

```bash
npx wrangler r2 bucket create lupi-assets
npx wrangler d1 create lupi-mcp
npx wrangler queues create lupi-render-jobs
npx wrangler d1 migrations apply lupi-mcp --local
npx wrangler d1 migrations apply lupi-mcp --remote
```

Then configure the bindings in `apps/mcp-worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "ASSETS"
bucket_name = "lupi-assets"

[[d1_databases]]
binding = "DB"
database_name = "lupi-mcp"
database_id = "<cloudflare-d1-database-id>"

[[queues.producers]]
binding = "RENDER_QUEUE"
queue = "lupi-render-jobs"
```

Set production secrets:

```bash
npx wrangler secret put LUPI_MCP_SHARED_SECRET
npx wrangler secret put RENDERER_TOKEN
```

Set `RENDERER_ENDPOINT` when a render backend exists. The renderer endpoint
receives:

```json
{
  "jobId": "job-...",
  "assetId": "sha256-...",
  "request": {
    "molecule": { "inputType": "template", "input": "Caffeine" },
    "asset": { "format": "png", "width": 1024, "height": 1024 },
    "viewer": { "cameraPreset": "iso" },
    "rendererVersion": "lupi-render-contract@2026-07-09"
  }
}
```

It should return:

```json
{
  "asset": {
    "dataBase64": "...",
    "mimeType": "image/png",
    "sha256": "optional-precomputed-hash"
  }
}
```

The Worker stores the bytes in R2 and updates the D1 job ledger.

## Tool Set

- `lupi.status`
- `lupi.search_molecules`
- `lupi.render_molecule_asset`
- `lupi.get_render_job`
- `lupi.get_asset`
- `lupi.viewer_manifest`

This is deliberately outcome-oriented. Agents ask for molecule assets and job
status, not browser camera clicks.

## Next Implementation Milestones

1. Bind real R2/D1/Queue resources in Cloudflare.
2. Add a render worker consumer that runs the existing browser export path behind
   the Cloudflare API as an implementation detail.
3. Extract GLB generation into a browser-free renderer for model exports.
4. Replace the shared-secret auth with Firebase/API-key verification once the
   auth helper lands.
