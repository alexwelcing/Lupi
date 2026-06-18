# Operations

`lupi.live` is a pnpm/turbo workspace for the LUPI molecular viewer.

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

- install pnpm 9
- install dependencies
- build the workspace
- run tests
- fail if regenerated NIST catalog output drifts
- run streaming and gallery smoke tests as non-blocking jobs

## Deploy

Production deploy is intentionally not enabled yet. The placeholder workflow is:

```text
.github/workflows/deploy-viewer.todo.yml
```

Do not remove the failing TODO until the old monorepo deploy path is split away
from legacy research-site output. See [deploy-cutover.md](deploy-cutover.md).

## Live Checks After Cutover

Keep these truths separate:

- CI result
- build artifact contents
- Cloud Run revision and traffic
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

After production deploy exists, prefer service rollback over source edits:

```bash
gcloud run revisions list --service=SERVICE --region=REGION
gcloud run services update-traffic SERVICE \
  --region=REGION \
  --to-revisions=REVISION=100
```

Verify the public domain after rollback. Cloud Run success alone is not proof
that `https://lupi.live` is serving the intended revision.
