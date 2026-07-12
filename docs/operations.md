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
pnpm exec playwright install --with-deps chromium
pnpm test:ui
```

`pnpm test:ui` starts `tools/serve-web.mjs` against `apps/web/dist` and checks
the production build. For a deployed preview or direct Worker URL, run only
the deployment-safe browser journeys:

```bash
UI_TEST_URL=https://PREVIEW_URL pnpm test:ui:deployed
```

## Broader Viewer Checks

```bash
pnpm test
pnpm test:ui
pnpm verify:mcp-bridge
pnpm verify:streaming-ux
pnpm verify:exports
pnpm verify:asset-quality
```

The UI suite writes failure traces, screenshots, and reports under
`test-results/` and `playwright-report/`. Focused legacy verifiers use
`.verify-artifacts/`.

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
- install Chromium and run the production Playwright UI suite
- run the standalone Cloud Functions tests
- fail if regenerated NIST catalog output drifts

## Deploy

The primary production deploy is:

```text
.github/workflows/deploy-cloudflare.yml
```

It builds the app and edge Worker, deploys through Wrangler, validates Worker
readiness, and exercises the live homepage and viewer with Playwright against
the direct `workers.dev` deployment URL. `.github/workflows/deploy-viewer.yml`
is the manual Cloud Run fallback and runs the same UI gate before routing
traffic. See [deploy-cutover.md](deploy-cutover.md).

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

For the Cloud Run fallback, prefer revision rollback over source edits:

```bash
gcloud run revisions list --service=SERVICE --region=REGION
gcloud run services update-traffic SERVICE \
  --region=REGION \
  --to-revisions=REVISION=100
```

Verify the public domain after rollback. Cloud Run success alone is not proof
that `https://lupi.live` is serving the intended revision.
