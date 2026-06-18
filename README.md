# lupi.live

Standalone LUPI molecular viewer repo.

This repo owns the browser-native molecular viewer at `lupi.live`: the WebGPU
viewer app, shared viewer packages, parser/runtime packages, viewer verification
tools, Firebase viewer support, saved views, API-key auth, and the agent/MCP
surface for loading and inspecting molecules.

It does not own the Lupine research corpus, public landing page, Lean proofs,
MLIP distillation policy, or experiment execution. Those stay in the science
control-plane and Library repos.

## Boundary

Owns:

- `apps/web`: public LUPI viewer
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

## Focused Verification

```bash
pnpm build
pnpm verify:controls --no-screenshot
pnpm verify:study-lens --no-screenshot
pnpm verify:mcp-bridge
pnpm verify:exports
```

For a fresh-clone confidence pass:

```bash
pnpm verify:standalone
```

Some visual verifiers launch Chromium and write artifacts under
`.verify-artifacts/`.

## App Map

- `apps/web`: Vite/React app that ships to `lupi.live`
- `apps/remotion-trailer`: media/rendering support app
- `packages/parsers`: LAMMPS/XYZ parsing and streaming contracts
- `packages/parsers/wasm`: Rust/WASM parser build
- `packages/renderer`: WebGPU renderer pieces
- `packages/scene`: 3D scene components
- `packages/ui`: viewer shell, panels, gallery, search, auth, exports
- `packages/core`: shared viewer types and utilities
- `functions`: Firebase custom-token/API-key and viewer backend helpers

## Deploy Status

Production deploy is owned by this standalone repo:

```text
.github/workflows/deploy-viewer.yml
```

The workflow builds only the viewer, packages `apps/web/dist` with the local
static server, deploys a no-traffic Cloud Run candidate, smokes it, and then
routes `lupi.live` traffic to the proven revision. See
[docs/deploy-cutover.md](docs/deploy-cutover.md).

## Docs

- [LUPINE.md](LUPINE.md): how this repo fits the Lupine constellation
- [docs/extraction-packet.md](docs/extraction-packet.md): original split plan
- [docs/api-keys.md](docs/api-keys.md): agent API-key auth flow
- [docs/lupi-mcp-roadmap.md](docs/lupi-mcp-roadmap.md): agent/MCP roadmap
- [docs/operations.md](docs/operations.md): local, CI, deploy, and live checks
- [docs/deploy-cutover.md](docs/deploy-cutover.md): production deploy split
- [docs/release-checklist.md](docs/release-checklist.md): cutover checklist
