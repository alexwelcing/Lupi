# Lupi Render Backend

The renderer that completes the Cloudflare MCP control plane (`apps/mcp-worker`).
The worker validates render requests, computes deterministic job/asset IDs, and hands
work to `RENDERER_ENDPOINT` — this service is that endpoint. Without it, worker render
requests return `awaiting_renderer`; with it, they return finished PNGs stored in R2.

Self-contained: the image builds the LUPI web app and drives it on localhost through
the in-page MCP bridge (`__lupiViewerMcp`) in headless Chromium on SwiftShader — no GPU,
no dependency on production lupi.live, no bot-challenge surface.

## What it renders

Beyond the raw worker contract, this service is a **merch design system** (think product
customizer depth) for molecule assets:

- **PCA auto-orientation** — every molecule presents its principal structural plane to
  camera (the structure reads like chemistry, not a blob).
- **Colorways** (`src/colorways.json`) — named per-element color maps derived from the
  lupi.live molecule color selection + Gooten garment colors: `ion`, `ultraviolet`,
  `ember`, `verdant`, `roseline`, `lab`. Add a colorway by adding an entry.
- **True transparency** — the viewer's export path is opaque, so the engine renders each
  view over two known background plates and solves per-pixel alpha (dual-pass difference
  matting). Result: crisp DTG-safe transparent masters (no semi-transparent halos).
- **Product templates** (`src/products.json`) — exact-pixel Gooten-aligned renditions:
  poster ladder @300 DPI, tee/hoodie/tote DTG transparent @150 DPI, 11oz mug wrap,
  square social. Layout control per product: `contentWidthFraction`, `contentTopFraction`,
  background (`colorway` = the colorway's poster hex).

## Endpoints

- `GET /health` — readiness, available colorways/products.
- `POST /` — **mcp-worker renderer contract**: `{jobId, assetId, request}` →
  `{jobId, assetId, asset: {dataBase64, mimeType, sha256, byteLength}}`.
  `request.viewer.lupiColorway` selects a colorway; `request.asset.transparent` returns
  the matted master.
- `POST /v1/merch-asset` — design API:
  ```json
  { "molecule": "serotonin", "colorway": "ember", "product": "poster-18x24",
    "masterSize": 2160, "layout": { "contentWidthFraction": 0.68 } }
  ```
  → `{asset: {dataBase64, ...}, design: {...}}`. `product: "master"` returns the trimmed
  transparent master.

Optional `RENDERER_TOKEN` enforces `Authorization: Bearer <token>` (the worker sends it).

## Deploy (Cloud Run) + wire to the worker

```bash
# from repo root
gcloud builds submit --tag gcr.io/$PROJECT/lupi-render-backend -f apps/render-backend/Dockerfile .
gcloud run deploy lupi-render-backend \
  --image gcr.io/$PROJECT/lupi-render-backend \
  --memory 2Gi --cpu 2 --timeout 300 --concurrency 1 \
  --set-env-vars RENDERER_TOKEN=$TOKEN

# then in apps/mcp-worker:
wrangler secret put RENDERER_TOKEN         # same value
# wrangler.toml [vars]: RENDERER_ENDPOINT = "https://<cloud-run-url>/"
```

`--concurrency 1` because the viewer page is stateful; scale out with instances, not
threads. A batch of 50 molecules × 6 colorways runs by looping `POST /v1/merch-asset`
(or via the worker's `POST /v1/render` REST shortcut with `sync: true`).

## Local dev

```bash
pnpm build                                  # build the viewer once
npx serve -s apps/web/dist -l 4173 &        # serve it
cd apps/render-backend && npm install --no-workspaces
VIEWER_URL="http://127.0.0.1:4173/?sim=caffeine" npm start
npm run smoke                               # boots server, renders caffeine × ion
```

## Provenance

Engine behaviors (bridge protocol `{tool, arguments}`, `export_asset` opacity, Controls-panel
color injection, plate determinism, PCA framing) were validated end-to-end against the
production bridge `2026-07-07.asset-export` on 2026-07-10. The upstream fixes that would
simplify this service: bridge-level `elementColorOverrides`/`uniformAtomColor` in
`lupi.set_viewer`, and honoring `transparent: true` in `lupi.export_asset`.
