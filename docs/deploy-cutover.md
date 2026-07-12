# Deploy Cutover

The standalone `lupi.live` repo owns production deploys for the viewer. The
active migration target is Cloudflare: one edge Worker serves the built viewer,
compatibility auth routes, edge analytics, saved-view share HTML, and MCP.

## Current State

The repo has:

- standalone CI in `.github/workflows/ci.yml`
- production viewer deploy in `.github/workflows/deploy-viewer.yml`
- manual Cloudflare deploy in `.github/workflows/deploy-cloudflare.yml`
- a root `start` script that serves `apps/web/dist`
- Cloudflare edge runtime in `apps/mcp-worker`
- local build verification passing from this extracted copy

Cloud Run remains the existing production path until Cloudflare preview smoke
tests pass and DNS is cut over.

## Cutover Requirements

The production deploy must continue to satisfy these constraints:

1. Build only `apps/web/dist` and viewer-owned static assets.
2. Do not call the old `atlas/deploy_slim.py` path.
3. Do not build or upload retired research-site output.
4. Package only files needed by the viewer runtime.
5. Deploy to the intended Cloudflare Worker (`lupi-edge`).
6. Move `lupi.live` traffic only after Cloudflare preview smoke checks pass.
7. Keep Firebase functions/rules/indexes deploys separate until those backends are fully replaced.
8. Report deploy status to `glim-think` `/ops/report` once the Cloudflare workflow is promoted to production.

## Proposed Runtime Shape

```text
pnpm install --frozen-lockfile
pnpm cloudflare:build
pnpm cloudflare:test
pnpm cloudflare:deploy
```

The Worker should serve:

```text
apps/web/dist/
```

It should also handle `/mcp`, `/collectAnalytics`, `/view/:slug`, and Firebase
reserved auth paths from the same origin. It should not depend on the
science/control-plane repo at runtime.

## Required Secrets

Cloudflare deploy secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `LUPI_FIREBASE_WEB_API_KEY`

Optional Cloudflare/MCP secrets:

- `LUPI_MCP_SHARED_SECRET`
- `LUPI_RENDERER_TOKEN`

Firebase deploy secrets/config remain necessary only when deploying legacy
Firebase Functions, rules, and indexes.

Do not add:

- MLIP runner credentials
- Phoenix keys unrelated to viewer telemetry
- Library or landing-site deploy secrets

## Candidate First

Pushes to `main` deploy through the Cloudflare workflow. The workflow validates
the direct `workers.dev` deployment with Playwright before reporting success;
the public `lupi.live` WAF is intentionally outside that release gate. For
manual pre-release checks against any preview URL, run:

```bash
pnpm exec playwright install --with-deps chromium
UI_TEST_URL=https://PREVIEW_URL pnpm test:ui:deployed
```

Then verify manually:

- Gallery opens
- drag-and-drop path works
- molecule search returns gallery and public providers
- signed-out saved-view UI is understandable
- export drawer renders expected options
- public metadata and social preview are current

## Cloudflare Deploy Workflow

The Cloudflare deploy workflow:

1. Installs pnpm dependencies from this repo.
2. Builds the viewer with Cloudflare same-origin environment values.
3. Typechecks and tests the edge Worker.
4. Uploads required Worker secrets.
5. Deploys `apps/mcp-worker` through Wrangler.
6. Checks structured `/health` readiness and runs the homepage-to-viewer UI journeys against the direct Worker URL.
7. Uploads Playwright traces and screenshots when the deployed UI gate fails.

## Done State

Cutover is complete only when a fresh clone of this repo can build, verify, and
deploy the viewer to Cloudflare without the science/control-plane repo, and
`https://lupi.live` is proven live against the Cloudflare Worker.
