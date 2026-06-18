# Deploy Cutover

The standalone `lupi.live` repo owns production deploys for the viewer. Its
deploy path builds only the extracted viewer output and does not call the old
monorepo research-site pipeline.

## Current State

The repo has:

- standalone CI in `.github/workflows/ci.yml`
- production viewer deploy in `.github/workflows/deploy-viewer.yml`
- a root `start` script that serves `apps/web/dist`
- local build verification passing from this extracted copy

The old deploy placeholder was removed only after adding a viewer-only Cloud Run
bundle and disabling the monorepo viewer auto-deploy.

## Cutover Requirements

The production deploy must continue to satisfy these constraints:

1. Build only `apps/web/dist` and viewer-owned static assets.
2. Do not call the old `atlas/deploy_slim.py` path.
3. Do not build or upload retired research-site output.
4. Package only files needed by the viewer runtime.
5. Deploy to the intended Cloud Run viewer service.
6. Move traffic to latest revision only after smoke checks pass.
7. Deploy Firebase functions, rules, and indexes only when those files change.
8. Report deploy status to `glim-think` `/ops/report`.

## Proposed Runtime Shape

```text
pnpm install --frozen-lockfile
pnpm build
node tools/serve-web.mjs
```

The container should serve:

```text
apps/web/dist/
```

It should not depend on the science/control-plane repo at runtime.

## Required Secrets

Viewer deploy secrets only:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `GCP_SERVICE_NAME_VIEWER`

Firebase deploy secrets/config only when deploying viewer backend changes.

Do not add:

- Cloudflare Worker tokens for `glim-think`
- MLIP runner credentials
- Phoenix keys unrelated to viewer telemetry
- Library or landing-site deploy secrets

## Candidate First

The deploy workflow publishes each revision with no production traffic first,
smokes the tagged candidate URL, and only then routes traffic to that revision.
For manual pre-release checks against any preview URL, run:

```bash
VERIFY_URL=https://PREVIEW_URL pnpm verify:controls --no-screenshot
VERIFY_URL=https://PREVIEW_URL pnpm verify:study-lens --no-screenshot
VERIFY_URL=https://PREVIEW_URL pnpm verify:mcp-bridge
```

Then verify manually:

- Gallery opens
- drag-and-drop path works
- molecule search returns gallery and public providers
- signed-out saved-view UI is understandable
- export drawer renders expected options
- public metadata and social preview are current

## Deploy Workflow

The deploy workflow:

1. Installs pnpm dependencies from this repo.
2. Builds the viewer with the production Vite environment.
3. Runs a browser controls verifier.
4. Packages `apps/web/dist` with `tools/serve-web.mjs`.
5. Smokes the local bundle.
6. Deploys a tagged Cloud Run candidate with no traffic.
7. Smokes the candidate URL.
8. Routes production traffic to the candidate revision.
9. Smokes `https://lupi.live/`.
10. Reports deploy status to `glim-think` `/ops/report`.

## Done State

Cutover is complete only when a fresh clone of this repo can build, verify, and
deploy the viewer without the science/control-plane repo, and
`https://lupi.live` is proven live against the new service.
