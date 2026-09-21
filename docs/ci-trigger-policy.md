# CI trigger policy

**As of 2026-09-21 the direction is deploy speed.** A merge to `main` is live
on `https://lupi.live` in about two minutes, and the only thing a pull request
waits on is a merge gate budgeted at about five minutes. Testing is arranged
around that budget instead of the other way round.

| Workflow | Runs when | Blocks a merge | Budget |
| --- | --- | --- | --- |
| `ci.yml` (`LUPI CI`) | relevant pull-request and `main` paths, dispatch | yes | ~5 min: lint, contracts, build, unit, Worker and Cloud Functions tests, catalog drift, TestFlight source only when `apps/mobile` changed |
| `deploy-cloudflare.yml` | every push to `main`, dispatch | no; it is the release | ~2 min to traffic, then a four-test release smoke against the live site |
| `ui-regression.yml` | nightly, dispatch, pull requests that touch `tests/**` or `playwright.config.mjs` | no | ~15 min, full Playwright suite |
| `dependency-audit.yml` | weekly, dispatch, manifest or lockfile changes | no | ~3 min, both production audits |
| `deploy-render-backend.yml` | path-filtered pushes to `main`, dispatch | no | Cloud Build and Cloud Run rollout |

Rules:

- Do not add a step to `LUPI CI` that costs more than about a minute without
  removing one. If it needs a browser, it belongs in `ui-regression.yml` or
  in the post-deploy smoke.
- A red nightly regression or audit is a bug to fix on `main`, not a reason
  to put the slow job back in the gate.
- The production dependency audit still fails on a high advisory; it simply
  runs on dependency changes and weekly rather than on every push. Do not
  ignore an advisory to make it green.
- The August 2026 CI-noise audit found no duplicate event pair to prune;
  the path filters above are the current set.
