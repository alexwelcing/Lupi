# Deploy Cutover

The standalone `lupi.live` repo owns production deploys for the viewer. The
active migration target is Cloudflare: one edge Worker serves the built viewer,
compatibility auth routes, edge analytics, saved-view share HTML, and MCP.

## Current State

The repo has:

- one pull-request build check in `.github/workflows/ci.yml`
- push-to-main Cloudflare release in `.github/workflows/deploy-cloudflare.yml`
- a root `start` script that serves `apps/web/dist`
- Cloudflare edge runtime in `apps/mcp-worker`

Cloudflare is the only production path. The owner-gated checkpoint controller
and its reconciliation workflow were retired on 2026-09-20, and the Cloud Run
viewer fallback on 2026-10-09.

## Cutover Requirements

The production deploy must continue to satisfy these constraints:

1. Build only `apps/web/dist` and viewer-owned static assets.
2. Do not call the old `atlas/deploy_slim.py` path.
3. Do not build or upload retired research-site output.
4. Package only files needed by the viewer runtime.
5. Deploy to the intended Cloudflare Worker (`lupi-edge`).
6. Deploy on every push to `main`; `https://lupi.live/health` must then report
   the pushed commit.
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

The deploy runs in the `lupi-production-write-v2` GitHub environment with
`LUPI_CLOUDFLARE_WRITE_TOKEN_V2` and the non-secret `CLOUDFLARE_ACCOUNT_ID`
variable. The read and re-anchor environments, the read token and
`LUPI_RELEASE_CUTOVER_RECEIPT_SHA256` belonged to the retired controller; no
workflow uses them.

The repository-level `LUPI_FIREBASE_WEB_API_KEY` secret is build-only release
configuration. The Cloudflare release passes it to Vite together with the
public values in `apps/web/cloudflare.env.example`; Turbo explicitly forwards
that closed list. The resulting browser key is intentionally public in the web
bundle, remains API- and referrer-restricted in Google Cloud, and is not a
Cloudflare control-plane credential.

Runtime Worker secrets remain attached to the Worker and are preserved by
`keep_vars = true` during deploy:

- `LUPI_MCP_SHARED_SECRET`
- `RENDERER_TOKEN`

Firebase administrative deploy credentials remain necessary only when
deploying legacy Firebase Functions, rules, and indexes. The Firebase web API
key remains required for browser Auth and Firestore saved views during the
transition.

Do not add:

- MLIP runner credentials
- Phoenix keys unrelated to viewer telemetry
- Library or landing-site deploy secrets

## Checking a Deploy

There is no candidate step: a push to `main` deploys straight to
`https://lupi.live`. To run the release smoke against it (or any preview
origin with a Worker):

```bash
pnpm exec playwright install --with-deps chromium
UI_TEST_URL=https://lupi.live UI_TEST_EXPECT_HEALTH=true pnpm test:ui
```

Then look by hand, when the change touches them:

- Gallery opens
- drag-and-drop path works
- molecule search returns gallery and public providers
- signed-out saved-view UI is understandable
- export drawer renders expected options
- public metadata and social preview are current

## Cloudflare Deploy Workflow

The Cloudflare deploy workflow, on every push to `main`:

1. Installs pnpm dependencies from the frozen lockfile.
2. Builds the viewer and the edge Worker with Cloudflare same-origin and
   Firebase browser values.
3. Deploys `lupi-edge` with the pinned Wrangler, setting `LUPI_BUILD_SHA` to
   the commit.
4. Waits for `https://lupi.live/health` to report the commit.
5. Checks that `/` and its `/assets/index-*.js` load.

Nothing gates it. If `main` breaks, revert or fix it and push again.

## Done State

Cutover is complete only when a fresh clone of this repo can build and
deploy the viewer to Cloudflare without the science/control-plane repo, and
`https://lupi.live` is proven live against the Cloudflare Worker.
