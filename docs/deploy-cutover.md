# Deploy Cutover

The standalone `lupi.live` repo owns production deploys for the viewer. The
active migration target is Cloudflare: one edge Worker serves the built viewer,
compatibility auth routes, edge analytics, saved-view share HTML, and MCP.

## Current State

The repo has:

- standalone CI in `.github/workflows/ci.yml`
- break-glass Cloud Run fallback in `.github/workflows/deploy-viewer.yml`
- owner-gated Cloudflare release in `.github/workflows/deploy-cloudflare.yml`
- read-only and owner-recovery controller in
  `.github/workflows/reconcile-cloudflare-deploy.yml`
- a root `start` script that serves `apps/web/dist`
- Cloudflare edge runtime in `apps/mcp-worker`
- local build verification passing from this extracted copy

Cloudflare is the production path. Cloud Run is retained only as a separately
authorized break-glass fallback.

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

## Required Release Authority

The v2 controller uses literal GitHub environments and separately scoped
credentials:

- `lupi-production-read-v2`: `LUPI_CLOUDFLARE_READ_TOKEN_V2`
- `lupi-production-write-v2`: `LUPI_CLOUDFLARE_WRITE_TOKEN_V2`
- `lupi-production-reanchor-v2`: `LUPI_CLOUDFLARE_READ_TOKEN_V2`

Each environment carries the non-secret `CLOUDFLARE_ACCOUNT_ID` variable. A
protected repository variable named `LUPI_RELEASE_CUTOVER_RECEIPT_SHA256` binds
the separately approved cutover receipt. The legacy `prod` token is removed
after the v2 environments are populated and verified.

Runtime Worker secrets remain attached to the Worker and are preserved by
`keep_vars = true` during version upload:

- `LUPI_MCP_SHARED_SECRET`
- `RENDERER_TOKEN`

Firebase deploy secrets/config remain necessary only when deploying legacy
Firebase Functions, rules, and indexes.

Do not add:

- MLIP runner credentials
- Phoenix keys unrelated to viewer telemetry
- Library or landing-site deploy secrets

## Candidate First

Production release is manual and owner-only. It requires an exact current-main
SHA, a fresh self-contained checkpoint, the protected cutover-receipt digest,
and the typed confirmation documented in `operations.md`. The workflow uploads
an immutable no-traffic version and validates its direct preview with
Playwright before promotion. It then verifies `https://lupi.live` separately.
For manual pre-release checks against any preview URL, run:

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
4. Uses the read environment to validate the active predecessor and rollback target.
5. Uses the write environment to upload an immutable no-traffic version.
6. Checks structured `/health` readiness and runs the complete UI suite against the direct preview URL.
7. Records durable release intent, promotes the candidate, and verifies the custom domain.
8. Performs bounded rollback when post-promotion proof fails and retains all receipts for reconciliation.

## Done State

Cutover is complete only when a fresh clone of this repo can build, verify, and
deploy the viewer to Cloudflare without the science/control-plane repo, and
`https://lupi.live` is proven live against the Cloudflare Worker.
