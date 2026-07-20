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
pnpm lint
pnpm audit --prod --audit-level high
npm audit --prefix functions --omit=dev --audit-level=high
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:ui
```

These commands are Local-lane inputs only. Their definitions in source are not
evidence; retain command results for one exact SHA.

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
- run the real workspace lint gate and both production dependency audits
- build the workspace
- run tests
- run the release authority, receipt, workflow, and live-verifier unit suites
- install Chromium and run the production Playwright UI suite
- run the standalone Cloud Functions tests
- fail if regenerated NIST catalog output drifts

## Deploy

The source-side v2 controllers are:

```text
.github/workflows/deploy-cloudflare.yml
.github/workflows/reconcile-cloudflare-deploy.yml
```

They replace the former `push: main` traffic-first model in source. The release
workflow is manual `workflow_dispatch` only; it uploads an immutable no-traffic
candidate, verifies its preview, records durable intent, promotes in a separate
step, and then verifies the custom domain. The reconciliation workflow shares
the same non-cancelling single-writer queue and provides automatic read-only
detection plus owner-only recovery.

This is source truth, not Deploy truth. The v2 environments, scoped tokens,
protected-main ruleset, cutover receipt, workflow state, initial trusted root,
and production run require separate authorization and live proof. Until those
exist and pass, record Deploy, Live API, and Public site as **BLOCKED**. Do not
enable a controller, upload a version, or change traffic merely because this
source merged.

### Manual release envelope

Only `alexwelcing` may start a production release. Dispatch from
`refs/heads/main` with a full `target_sha` that equals the workflow SHA and the
repository API's current `main`, and type exactly:

```text
DEPLOY <target_sha> WITH BOUNDED ROLLBACK
```

The controller rejects reruns; after a queue delay or failure, dispatch a fresh
attempt. It also requires the exact trusted checkpoint artifact/run/digest and
the separately authorized v2 cutover-receipt digest. Never reuse inputs from an
older queued run without re-reading current `main` and the trusted root.

### Package-to-write boundary

The `release-package` job has no Cloudflare credential. It runs the source,
build, unit, audit, and controller gates, creates the tested Worker/assets
output, and emits a closed, digest-bound, data-only package. Credentialed jobs
do not trust a checkout or execute that package as code:

| Job class | Literal environment and credential | Allowed behavior |
|---|---|---|
| Admission/control read | `lupi-production-read-v2` with `LUPI_CLOUDFLARE_READ_TOKEN_V2` | Read deployment/version state and prove the prior target |
| Version upload, promotion, rollback | `lupi-production-write-v2` with `LUPI_CLOUDFLARE_WRITE_TOKEN_V2` | Validate downloaded data, bootstrap integrity-pinned Wrangler without a token, then expose the token only to one closed mutation step |
| Re-anchor control | `lupi-production-reanchor-v2` with the read token | Prove an owner-supplied active identity without changing traffic |
| Package, candidate/public verification, receipt/checkpoint, UI | no Cloudflare environment or token | Build/test/verify non-secret evidence only |

Write jobs may not check out repository source, install project dependencies,
build, test, execute candidate code, use local/reusable actions, or read
inherited/computed/broad secrets. The closed-world authority scan must prove the
literal mapping across current workflows and every still-rerunnable historical
snapshot before any credentialed job proceeds.

### Candidate and public proof

`versions upload` creates a full-SHA-tagged candidate without assigning traffic.
Retain its exact Worker version ID and immutable preview origin. The preview
runs `pnpm verify:cloudflare-live` and the complete UI suite before promotion.
That result is candidate evidence only.

Before the traffic step, `lupi-release-intent-v1` binds the owner confirmation,
prior/candidate identities, package, expected posture, rollback contract, and
rollback eligibility. Promotion re-reads the single 100%-active prior and then
assigns the candidate 100%. Afterward, a separate custom-domain report must
match `https://lupi.live` to the same Git SHA/Worker version and to the
candidate's entry bytes, and the complete UI suite must pass there. Only a
validated `lupi-release-outcome-v1` closes success. Candidate PASS never implies
Live API or Public site PASS.

### Reconciliation and checkpoints

The reconciler runs after production workflow completion, on owner-only manual
dispatch, and weekly at `17 7 * * 1`. Automatic paths use read authority only:
they can verify a no-op, emit a rollback-required incident, and carry the last
trusted outcome into a fresh `lupi-release-checkpoint-v1`; they cannot change
traffic. A manual rollback, `refresh-checkpoint`, or re-anchor requires exact
owner/current-main/first-attempt admission and one of these confirmations:

```text
ROLLBACK <prior-version-id>
REFRESH <target-sha>
REANCHOR <active-version-id>
```

Intent, outcome, resolution, reconciliation reports, and checkpoints are the
durable chain. A checkpoint must be self-contained, no older than 30 days, have
at least seven days before expiry, and embed the complete active rollback
bundle. A hash or link to an expiring parent is not enough. Any missing,
expired, truncated, third-version, or split-deployment state is a STOP.

GitHub may auto-disable scheduled workflows in an inactive public repository.
The weekly cron is therefore not a durability guarantee. During repository
inactivity, at least every 30 days the owner must use read-only GitHub evidence
to confirm that the reconciliation workflow state is `active`, inspect the
newest checkpoint age/expiry, and retain the receipt. If auto-disabled, stop
releases; inspect and separately re-enable the exact integrated workflow, then
run an owner-only refresh. If the chain is no longer valid, use the full
read-only-control/no-secret-reconstruction re-anchor path instead of refresh.

### Authority and prohibited side channels

The repository intentionally has one release owner and no two-person approval
requirement. Exact-owner/current-main checks, typed confirmations, split
read/write credentials, and durable receipts reduce stale-writer and operator-
error risk. They do not independently contain compromise of the one owner
account that controls source and production; record that residual risk in each
release decision.

Routine Cloudflare dashboard/CLI deploys, traffic edits, environment edits, or
secret creation/rotation are prohibited because they bypass reconciliation.
External v2 environment, token, workflow-state, and main-ruleset changes occur
only during a separately authorized cutover with non-secret receipts. A
break-glass change must first hold both controllers, state its authority and
rollback target, and produce separate post-change Deploy/Live/Public evidence.
The legacy Cloud Run workflow is a break-glass surface, not a routine alternate
release path. See [deploy-cutover.md](deploy-cutover.md).

## Five-lane release receipt

Start every release report with named accountable operators and this table:

| Lane | Status | Exact SHA/version | Evidence | Notes or blocker |
|---|---|---|---|---|
| Local | NOT CHECKED | — | — | — |
| CI | NOT CHECKED | — | — | — |
| Deploy | BLOCKED | — | v2 source only | cutover environments/tokens/ruleset/workflow state are not yet separately authorized and proven |
| Live API | BLOCKED | — | — | no authorized v2 promotion/custom-domain receipt |
| Public site | BLOCKED | — | — | no authorized v2 promotion/public journey receipt |

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

- Correctness baseline (Plan 023): the source implementation now includes real
  lint, dependency gates, regression tests, and v2 release controllers; it is
  not complete until exact-SHA CI and the separately authorized cutover/live
  evidence pass.
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

The normal Cloudflare rollback path is the bounded controller action already
recorded in release intent. It re-reads that the candidate alone is active,
restores only the exact validated prior version, re-reads control-plane state,
and runs the prior release's receipt-pinned exact-source UI suite. Independent
reconciliation never writes automatically; it emits an incident and requires a
fresh owner-confirmed `reconcile-rollback` dispatch.

Do not improvise a dashboard or routine CLI rollback. If the trusted prior,
intent, checkpoint, eligibility window, or single-active-version assertion
cannot be proved, hold traffic and treat it as a release-control incident. Any
break-glass Cloud Run rollback requires separate authorization and still needs
independent Live API and Public site evidence for `https://lupi.live`; a provider
command alone is not rollback proof.
