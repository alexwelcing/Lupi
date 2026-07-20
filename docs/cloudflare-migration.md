# Cloudflare App Migration

Lupi is moving from a Cloud Run static server plus Firebase Functions to a
Cloudflare edge Worker that serves the whole app and owns the agent/API edge.

## Target Runtime

The Cloudflare deployment target is `apps/mcp-worker`, deployed as the
`lupi-edge` Worker. The directory name is historical; the Worker now serves the
web app and the MCP control plane.

Routes owned by the Worker:

- `/` and normal app paths — served from `apps/web/dist` through Workers static assets.
- `/assets/*` — Vite chunks/static assets, except deterministic MCP render assets.
- `/assets/sha256-<hash>.<ext>` — rendered molecule assets from R2 when configured.
- `/__/auth/*` and `/__/firebase/*` — proxied to Firebase Hosting reserved auth paths so popup auth still works with `authDomain=lupi.live`.
- `/view/:slug` — social-preview HTML for saved views, backed by Firestore REST during the transition.
- `/collectAnalytics` and `/api/analytics` — first-party analytics collector at the edge.
- `/mcp`, `/v1/render`, `/v1/jobs/:jobId`, `/mcp-manifest.json`, `/health` — agent-native MCP/control-plane endpoints that execute Worker code first.
- `/browser-mcp-manifest.json` — the static 28-tool browser-viewer manifest;
  it remains asset-first with the SPA and fingerprinted web bundles.

## Build And Run

```bash
pnpm cloudflare:build
pnpm cloudflare:test
pnpm cloudflare:dev
```

`cloudflare:dev` builds `apps/web/dist` first because Workers static assets serve
the production bundle, not the Vite dev server.

The Cloudflare Vite environment is documented in
`apps/web/cloudflare.env.example`. Production deploys should use same-origin
values for MCP and analytics: `VITE_LUPI_MCP_ENDPOINT=/mcp` and
`VITE_LUPI_ANALYTICS_URL=/collectAnalytics`.

## Deploy

Manual GitHub workflow:

```text
.github/workflows/deploy-cloudflare.yml
```

Required GitHub secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `LUPI_FIREBASE_WEB_API_KEY`

Required deployment secrets when enabling authenticated legacy rendering:

- `LUPI_MCP_SHARED_SECRET`
- `LUPI_RENDERER_TOKEN`

The renderer URL is a non-secret deployment variable mapped to
`RENDERER_ENDPOINT`. These values are not required while render execution stays
disabled.

Required Cloudflare resources before production cutover:

- Worker: `lupi-edge`
- Workers static assets binding: `WEB_ASSETS` from `apps/web/dist`
- Public R2 bucket: `lupi-assets` bound as `ASSETS` for pruned gallery payloads
- Private R2 buckets: `lupi-render-artifacts` in production and
  `lupi-render-artifacts-preview` in preview, bound as `RENDER_ASSETS`; neither
  may have an `r2.dev` endpoint or public custom domain
- D1 database `lupi-mcp` and Queue `lupi-render-jobs` remain reserved for a
  future asynchronous profile and are not required by the first synchronous
  authenticated renderer lane

Large gallery payloads listed in `apps/web/cloudflare-assets-exclude.json` are
pruned from Workers static assets and served from the `lupi-assets` R2 bucket via
the `ASSETS` binding. These object paths must exist before cutover:

- `gallery/curated/lupine_genesis.lammpstrj`
- `gallery/curated/lupine_genesis.glimbin`
- `gallery/research/hfc/r32_nvt_273K.glimbin`
- `gallery/research/hfc/r125_nvt_273K.glimbin`

## Current Transitional Dependencies

This slice moves the app edge to Cloudflare but intentionally keeps these
services while we avoid a risky all-at-once rewrite:

- Firebase Auth remains the identity provider.
- Firestore remains the saved-view/API-key store.
- Firestore REST is used by the Cloudflare Worker for public `/view/:slug` social HTML.
- The old Firebase Functions API-key endpoints remain until their admin-token behavior is replaced by a Cloudflare-compatible service account flow.
- Heavy NIST/open-data artifacts can still live in GCS until copied or fronted by R2/CDN.

## Cutover Checklist

1. Deploy `lupi-edge` from the manual workflow.
2. Verify `https://<worker-preview>/health` reports `webAssets: true`.
3. Smoke `https://<worker-preview>/`, `/materials/clean-energy`, `/view/<known-public-slug>`, `/collectAnalytics`, and `/mcp`.
4. Confirm Firebase popup sign-in works through `/__/auth/handler` on the Cloudflare hostname.
5. To enable the bounded legacy renderer, bind private `RENDER_ASSETS`, configure
   `RENDERER_ENDPOINT`, and set distinct caller and renderer bearer secrets.
   Otherwise keep execution disabled. This does not activate RenderRequestV1.
6. Point `lupi.live` DNS/route to the Cloudflare Worker.
7. After successful production smoke tests, disable the Cloud Run push deploy workflow or keep it as an explicit manual rollback path only.
