# Operations

`lupi.live` is a pnpm/turbo workspace for the LUPI molecular viewer.

Operate it under the [product ownership contract](product-ownership-contract.md)
and [release truth contract](release-truth-contract.md). A command list is not a
release receipt; record each truth lane separately for one exact SHA.

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
pnpm verify:product-contract
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:ui
```

The root lint command is not release evidence until Plan 023 establishes and
tests a non-vacuous workspace lint gate.

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
- test and verify the product/release contracts
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
the direct `workers.dev` endpoint returned by the action.
`.github/workflows/deploy-viewer.yml`
is the manual Cloud Run fallback and runs the same UI gate before routing
traffic. See [deploy-cutover.md](deploy-cutover.md).

The current Cloudflare workflow provides partial evidence against a mutable
direct endpoint only. It does not record an immutable Git/Worker Version ID or
version-specific preview URL, and it does not by itself prove
rollback target, custom-domain API, mobile behavior, saved-view recovery,
authenticated rendering, or artifact bytes. The correctness/security release
baseline wave (operator Plan 023) owns that gate.

## Five-lane release receipt

Start every release report with named accountable operators and this table:

| Lane | Status | Exact SHA/version | Evidence | Notes or blocker |
|---|---|---|---|---|
| Local | NOT CHECKED | — | — | — |
| CI | NOT CHECKED | — | — | — |
| Deploy | NOT CHECKED | — | — | — |
| Live API | NOT CHECKED | — | — | — |
| Public site | NOT CHECKED | — | — | — |

Allowed statuses are PASS, FAIL, NOT CHECKED, and BLOCKED. Direct
`workers.dev` and custom-domain evidence are separate observations. Do not call
the release production-green when only Local or CI passes.

Minimum evidence is defined normatively in the
[release truth contract](release-truth-contract.md). In particular:

- Local records the exact SHA, clean integration worktree, frozen install, and
  every relevant command result.
- CI records the exact-SHA run URL, conclusion, and required jobs.
- Deploy records the run, immutable candidate/revision, bindings, and previous
  rollback target.
- Live API verifies custom-domain health/version/bindings, distinct edge and
  browser manifests, auth posture, and relevant render/job/asset behavior.
- Public site proves discovery, a loaded real molecule/canvas, mobile controls,
  saved-view success/error, and actual exported bytes when relevant.

## Current program prerequisites

The following capability gates are not claimed complete by this operations
document. Plan numbers are operator execution references, not definitions of
readiness:

- Correctness baseline (Plan 023): security, dependencies, real lint, regression tests,
  exact release identity, rollback, and custom-domain verification.
- Render and edge truth (Plans 018–020 and 024): routing, render/artifact identity, bounded inputs,
  persistence, and delivery truth.
- Human loop (Plan 025): inspect/measure/provenance/reset/save/reopen completion.
- Authenticated-agent loop (Plan 026): scoped auth and authenticated
  render/poll/retrieve/cache-hit.

Until each owner produces its required evidence, mark the affected lane NOT
CHECKED or BLOCKED rather than treating the intended behavior as shipped.

## Live checks after cutover

Expected live smoke:

- home route loads
- a built-in molecule opens
- Gallery search returns results
- NIST and OMol providers behave as expected
- signed-out saved views degrade correctly
- auth posture matches the reviewed release expectation; do not use a real key
  until Plan 026 ships the scoped flow
- edge and browser MCP manifests retain their intentionally distinct contracts
- export controls produce and return bytes only for actually supported formats

## Rollback

For the Cloud Run fallback, prefer revision rollback over source edits:

```bash
gcloud run revisions list --service=SERVICE --region=REGION
gcloud run services update-traffic SERVICE \
  --region=REGION \
  --to-revisions=REVISION=100
```

Verify the public domain after rollback. Cloud Run success alone is not proof
that `https://lupi.live` is serving the intended revision. Record rollback and
post-rollback Live API/Public site evidence as separate receipt entries.
