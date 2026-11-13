# lupi.live: repository map

Moved from the root [README](../README.md) on 2026-11-13, when the README was cut
to one screen. The text is unchanged; only link paths are adjusted for this folder.

## App Map

- `apps/web`: Vite/React app that ships to `lupi.live`
- `apps/mcp-worker`: the Cloudflare edge Worker (`lupi-edge`) that serves the
  built web app, MCP at `/mcp` and `/chatgpt/mcp`, and the `/v1` routes;
  deployed on every merge to `main`
- `apps/apple`: the native iPhone and iPad app and its Swift packages
- `apps/mobile`: Expo Router iPhone app, frozen as a reference
- `apps/chatgpt-widget`: the ChatGPT MCP App resource
  `ui://lupi/molecule-v2.html`, built as one HTML file that the web build
  copies to `/chatgpt-widget/index.html`
- `apps/render-backend`: the Cloud Run container behind the Worker's legacy-v0
  PNG render handoff; it drives the built viewer in Chromium and is deployed
  by `.github/workflows/deploy-render-backend.yml`
- `apps/lupine-app`: the Lupine Science self-serve service (Stripe
  subscriptions on the shared Firebase account); not deployed from this
  repo's workflows, only by hand with `gcloud builds submit`
- `apps/remotion-trailer`: media/rendering support app
- `packages/parsers`: LAMMPS/XYZ parsing and streaming contracts
- `packages/parsers/wasm`: Rust/WASM parser build
- `packages/renderer`: raw WebGPU pieces; the viewer uses only its optional
  bond-detection compute pass (`BondPipeline`)
- `packages/scene`: 3D scene components and the TSL impostor materials
- `packages/ui`: viewer shell, panels, gallery, search, auth, exports
- `packages/ui-core`: `@lupine/ui`, design tokens and a small React component
  kit; the web app imports its tokens (`theme/design-system.css`), and no
  mounted viewer surface uses its components
- `packages/core`: shared viewer types and utilities
- `packages/assessment`: rendering-free grading of atomistic assets, behind
  `lupi.assess_asset` in the browser bridge and on the edge
- `packages/nist`: the NIST Interatomic Potentials catalog loader and queries
  behind the Library's potentials collection and the NIST search provider;
  `pnpm nist:build` writes the catalog it reads (`apps/web/public/nist`)
- `functions`: Firebase custom-token/API-key and viewer backend helpers

## Docs

- [LUPINE.md](../LUPINE.md): how this repo fits the Lupine constellation
- [docs/product-ownership-contract.md](product-ownership-contract.md): normative product boundary
- [docs/release-truth-contract.md](release-truth-contract.md): what a check proves, and what it does not
- [docs/extraction-packet.md](extraction-packet.md): original split plan
- [docs/api-keys.md](api-keys.md): legacy API-key backend inventory and Plan 026 target
- [docs/lupi-mcp-roadmap.md](lupi-mcp-roadmap.md): agent/MCP roadmap
- [docs/operations.md](operations.md): local, CI, deploy, and live checks
- [docs/deploy-cutover.md](deploy-cutover.md): production deploy split
- [docs/release-checklist.md](release-checklist.md): what to look at before and after a release
- [docs/ar/README.md](ar/README.md): the native Apple app's plan, decisions, contracts and status
- [docs/mobile-macbook-air-handoff.md](mobile-macbook-air-handoff.md): Apple Silicon handoff for the frozen Expo app

## More

- [Overview](overview.md)
- [Development](development.md)
- [Privacy](privacy.md)
