# Deploy Cutover

The standalone `lupi.live` repo should not enable production deploys until the
viewer deploy path is separated from old monorepo research-site output.

## Current State

The repo has:

- standalone CI in `.github/workflows/ci.yml`
- a deliberately failing deploy placeholder in
  `.github/workflows/deploy-viewer.todo.yml`
- a root `start` script that serves `apps/web/dist`
- local build verification passing from this extracted copy

The deploy placeholder is intentional. It prevents a copied repo from looking
production-ready before the infrastructure boundary is real.

## Cutover Requirements

Before enabling production deploy:

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

## Preview First

Before mapping `lupi.live`, deploy a preview service and run:

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

## Enabling Deploy

When the preview path is proven:

1. Replace `deploy-viewer.todo.yml` with a real deploy workflow.
2. Keep the workflow rooted at this repo, not the old monorepo paths.
3. Run `pnpm build` and at least one browser verifier before deploy.
4. Smoke the deployed preview.
5. Route domain traffic.
6. Record live proof in the release notes or PR.

## Done State

Cutover is complete only when a fresh clone of this repo can build, verify, and
deploy the viewer without the science/control-plane repo, and
`https://lupi.live` is proven live against the new service.
