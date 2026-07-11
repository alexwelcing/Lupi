# Operations

`lupi.live` is a pnpm/turbo workspace for the LUPI molecular viewer and the canonical Cloudflare Worker production runtime (`lupi-edge`).

## Local Setup

Use Git Bash for Node tasks on Windows.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

The Vite app runs at `http://localhost:5173` by default.

## Fast Confidence Checks

```bash
pnpm build
pnpm verify:controls --no-screenshot
pnpm verify:study-lens --no-screenshot
```

`verify:controls` and `verify:study-lens` start a portless Vite server
themselves unless `VERIFY_URL` is set.

Fresh-clone check:

```bash
pnpm verify:standalone
```

## Broader Viewer Checks

```bash
pnpm verify:viewer
pnpm verify:controls
pnpm verify:controls:mobile
pnpm verify:study-lens
pnpm verify:study-lens:mobile
pnpm verify:mcp-bridge
pnpm verify:gallery
pnpm verify:streaming
pnpm verify:exports
pnpm verify:export-colors
pnpm verify:saved-views
pnpm verify:save-view-ui
```

Some checks require Playwright Chromium. Some checks write screenshots and JSON
reports under `.verify-artifacts/`.

## Parser And Data Checks

```bash
pnpm test:rust
pnpm nist:build
pnpm doctor path/to/file.lammpstrj
```

Use `pnpm doctor` when debugging user-supplied LAMMPS dumps. It exercises the
same dump compatibility contract used by the viewer.

## CI

Workflow:

```text
.github/workflows/ci.yml
```

Current CI does:

- install pnpm 9 with `pnpm install --frozen-lockfile`
- build the workspace
- run tests
- run lint
- run Cloudflare Worker tests
- verify browser MCP bridge workflows
- verify export/asset quality
- regenerate MCP manifests and the NIST catalog, then fail on drift
- verify operational documentation references only package.json scripts and the `lupi-edge` production runtime

## Deploy

Production is Cloudflare Worker `lupi-edge`:

```text
.github/workflows/deploy-cloudflare.yml
apps/mcp-worker/wrangler.toml
```

The Cloudflare workflow builds `apps/web`, builds/tests `apps/mcp-worker`, then
deploys the Worker that serves the static viewer, MCP JSON-RPC, health and
manifest endpoints, saved-view HTML, analytics collection, Firebase auth proxy
paths, render job intake, and asset delivery. The Cloud Run workflow is manual
only and exists as an explicitly triggered fallback/rollback path.

## Live Checks After Cutover

Keep these truths separate:

- CI result
- build artifact contents
- Cloudflare Worker version/route for `lupi-edge`
- Cloud Run revision and traffic only when the manual fallback workflow is used
- Firebase functions/rules deploy state
- live `https://lupi.live` behavior
- deploy telemetry in `glim-think`

Expected live smoke:

- home route loads
- a built-in molecule opens
- Gallery search returns results
- NIST and OMol providers behave as expected
- signed-out saved views degrade correctly
- API-key exchange is tested with a staging or real test key
- MCP bridge reports the expected auth state
- export controls produce PNG/JPG/USDZ/video as supported

## Rollback

Preferred rollback is Cloudflare-first: redeploy the last known-good commit with
`pnpm cloudflare:build`, `pnpm cloudflare:test`, and `pnpm cloudflare:deploy`, or
use the Cloudflare dashboard/API rollback for Worker `lupi-edge` after recording
the target version. If Cloudflare is unavailable, manually trigger
`.github/workflows/deploy-viewer.yml` as the Cloud Run fallback and verify the
public domain before declaring recovery. Cloud Run success alone is not proof
that `https://lupi.live` is serving the intended runtime.
