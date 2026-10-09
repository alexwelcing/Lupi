# Operations

`lupi.live` is a pnpm/turbo workspace for the LUPI molecular viewer.

Operate it under the [product ownership contract](product-ownership-contract.md)
and [release truth contract](release-truth-contract.md). By owner decision
(2026-10-09) CI and verification are cut to the bone: punch and solve, and if
`main` breaks, fix it and push again.

## Local Setup

Use Git Bash for Node tasks on Windows.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

The Vite app runs at `http://localhost:5173` by default.

## Optional Local Checks

None of these gate a merge or a deploy. Run the ones that help your diff.

```bash
pnpm test
pnpm lint
pnpm verify:viewer-smoke
pnpm test:ui
```

- `pnpm test` runs every workspace's unit tests. It does not need a build.
- `pnpm verify:viewer-smoke` drives the built app (`pnpm build` first) in the
  WebGL2 lane: home, caffeine, an export and the renderer fallback, in about a
  minute. It writes under `.verify-artifacts/viewer-smoke/`.
- `pnpm test:ui` serves `apps/web/dist` through `tools/serve-web.mjs` and runs
  the one release smoke, `tests/ui/release-smoke.spec.ts`. Against a deployed
  origin:

  ```bash
  UI_TEST_URL=https://lupi.live UI_TEST_EXPECT_HEALTH=true pnpm test:ui
  ```

Install Chromium once if absent (`pnpm exec playwright install --with-deps
chromium`). The UI run writes failure traces under `test-results/` and
`playwright-report/`.

Also at hand: `pnpm apple:check` (the Swift generated from the web's
TypeScript is current) and `node tools/inspect-glb.mjs <file.glb>`.

To look at your own work, write a scratch Playwright script and don't commit
it. Add no new smoke plugins, verifiers, golden fixtures or receipts.

## Parser And Data Checks

```bash
pnpm test:rust
pnpm nist:build
pnpm doctor path/to/file.lammpstrj
```

Use `pnpm doctor` when debugging user-supplied LAMMPS dumps. It exercises the
same dump compatibility contract used by the viewer.

## CI

`.github/workflows/ci.yml` runs one job, `build-test`, on pull requests:
`pnpm install --frozen-lockfile`, `pnpm build` and a pinned-Wrangler
`versions upload --dry-run` (about 3 minutes). Its name is the required check
of the `main` ruleset. It runs no tests, lint, audit or Playwright, and has no
push trigger. Dependabot alerts in the repository's GitHub settings replace
the old dependency-audit gate. The path-filtered workflows are listed in
[ci-trigger-policy.md](ci-trigger-policy.md).

## Deploy

A push to `main` is the release. `deploy-cloudflare.yml` builds the web app
and the edge Worker, runs `wrangler deploy` with the pinned Wrangler
(`.github/wrangler-runtime`) in the `lupi-production-write-v2` environment,
waits for `https://lupi.live/health` to report the commit, then checks that
`/` and its `/assets/index-*.js` load. Nothing gates it. A manual dispatch
runs it again.

That run proves the deploy and that the shell loads. It does not prove the
viewer works; see the [release truth contract](release-truth-contract.md).

The owner-dispatched v2 release controller and its reconciliation workflow
were retired on 2026-09-20, and the Cloud Run viewer fallback on 2026-10-09.
They are in git history.

## Live checks after a deploy

When a change touches them, look by hand:

- home route loads
- a built-in molecule opens
- Gallery search returns results
- NIST and OMol providers behave as expected
- signed-out saved views degrade correctly
- auth posture matches what the change expects; do not use a real key
  until Plan 026 ships the scoped flow
- edge and browser MCP manifests retain their intentionally distinct contracts
- export controls produce and return bytes only for actually supported formats

## Current program prerequisites

The following capability gates are not claimed complete by this operations
document. Plan numbers are operator execution references, not definitions of
readiness:

- Correctness baseline (Plan 023): its lint, dependency, regression and
  release-controller gates were removed from CI and the release by owner
  decision (2026-09-20 and 2026-10-09).
- Render and edge truth (Plans 018–020 and 024): routing, render/artifact identity, bounded inputs,
  persistence, and delivery truth.
- Human loop (Plan 025): inspect/measure/provenance/reset/save/reopen completion.
- Authenticated-agent loop (Plan 026): scoped auth and authenticated
  render/poll/retrieve/cache-hit.

Until each is shown working, don't describe the intended behavior as shipped.

## Rollback

Revert the bad commit on `main`, or push a fix; the push redeploys. It is done
when `https://lupi.live/health` reports that commit. A Cloudflare dashboard or
CLI rollback leaves production and `main` apart until the next push overwrites
it, so prefer the revert.
