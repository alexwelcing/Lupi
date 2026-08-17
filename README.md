# lupi.live

Standalone LUPI molecular viewer repo.

This repo owns the browser-native molecular viewer at `lupi.live`: the WebGPU
viewer app, shared viewer packages, parser/runtime packages, viewer verification
tools, Firebase viewer support, saved views, authentication contracts, and the
agent/MCP surface for loading and inspecting molecules.

The normative boundary is the
[Lupi product ownership contract](docs/product-ownership-contract.md). It wins
when an older roadmap, campaign plan, branch, or overview conflicts with it.

It owns the lightweight `lupi.live` discovery/landing shell that opens the
viewer. It does not own the Lupine editorial/public-science front door at
`lupine.science`, the research corpus, Lean proofs, MLIP distillation policy, or
experiment execution. Those stay in the science control-plane and Library
repos.

## Boundary

Owns:

- `apps/web`: public LUPI viewer
- `apps/mobile`: Expo Router iPhone shell, native Gallery/Library/import/settings,
  constrained viewer bridge, diagnostics, and bounded ARKit Room experience
- `packages/core`, `packages/parsers`, `packages/renderer`, `packages/scene`,
  `packages/ui`, `packages/ui-core`
- `functions`: viewer Firebase functions
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- `tools`: viewer smoke tests, gallery checks, export checks, MCP checks, asset tools
- `popular_molecules`, public gallery assets, and viewer-owned manifests

Does not own:

- article bodies or Library shelves
- science claim decisions
- Lean proof source
- MLIP/Distill runtime policy
- `lupine.science` landing copy
- old `apps/lupi-studio` or nested marketing-site experiments

## Quick Start

Use Git Bash for Node tasks on Windows.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `http://localhost:5173`.

## iPhone development

The Expo SDK 57 app lives in `apps/mobile`. Room uses a custom native Viro/ARKit
runtime, so native development uses Lupi Dev rather than Expo Go. For the
resource-conscious Apple Silicon setup, current Git/Expo identities, physical
iPhone loop, and Codex startup prompt, follow the
[M2 MacBook Air handoff guide](docs/mobile-macbook-air-handoff.md).

## Terminal Authentication (planned—not yet shipped)

The tracked repository does not currently ship a tested `lupi:auth` package
script or a verified API-key management panel in the active Account shell. Do
not direct users or agents to a terminal login flow yet.

The existing Functions/data model and intended HTTP exchange are retained as
implementation inventory in [docs/api-keys.md](docs/api-keys.md). The operator's
authenticated-agent golden-path work (operator Plan 026) owns reconciling
the local helper, replacing broad identity exchange with the scoped agent
contract, testing the UI/client, and proving the live flow before this section
may become user instructions.

## Focused Verification

```bash
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:ui
pnpm verify:mcp-bridge
pnpm verify:exports
```

`pnpm test:ui` serves the production build and exercises homepage discovery,
the real molecule viewer and settings, and the mobile controls. To run the
deployment-safe subset against a public preview or Worker URL:

```bash
UI_TEST_URL=https://PREVIEW_URL pnpm test:ui:deployed
```

Playwright writes failure diagnostics under `playwright-report/` and
`test-results/`. The focused legacy verifiers write under `.verify-artifacts/`.

## App Map

- `apps/web`: Vite/React app that ships to `lupi.live`
- `apps/mobile`: Expo Router iPhone app and native Room AR shell
- `apps/remotion-trailer`: media/rendering support app
- `packages/parsers`: LAMMPS/XYZ parsing and streaming contracts
- `packages/parsers/wasm`: Rust/WASM parser build
- `packages/renderer`: WebGPU renderer pieces
- `packages/scene`: 3D scene components
- `packages/ui`: viewer shell, panels, gallery, search, auth, exports
- `packages/core`: shared viewer types and utilities
- `functions`: Firebase custom-token/API-key and viewer backend helpers

## Deploy Status

Production deploy is owned by this standalone repo. The primary workflow is
`.github/workflows/deploy-cloudflare.yml`.
It builds and tests the app and edge Worker, deploys through Wrangler, then
runs the deployed Playwright UI gate against the direct `workers.dev` URL.
`.github/workflows/deploy-viewer.yml` remains the manual Cloud Run fallback.
That job is partial evidence against a mutable direct `workers.dev` endpoint;
it does not record immutable Worker Version identity and is not proof of the
custom domain or public product. See the
[release truth contract](docs/release-truth-contract.md).

## Docs

- [LUPINE.md](LUPINE.md): how this repo fits the Lupine constellation
- [docs/product-ownership-contract.md](docs/product-ownership-contract.md): normative product boundary
- [docs/release-truth-contract.md](docs/release-truth-contract.md): five-lane evidence contract
- [docs/extraction-packet.md](docs/extraction-packet.md): original split plan
- [docs/api-keys.md](docs/api-keys.md): legacy API-key backend inventory and Plan 026 target
- [docs/lupi-mcp-roadmap.md](docs/lupi-mcp-roadmap.md): agent/MCP roadmap
- [docs/operations.md](docs/operations.md): local, CI, deploy, and live checks
- [docs/deploy-cutover.md](docs/deploy-cutover.md): production deploy split
- [docs/release-checklist.md](docs/release-checklist.md): cutover checklist
- [docs/mobile-macbook-air-handoff.md](docs/mobile-macbook-air-handoff.md): Apple Silicon mobile-development handoff
