# CI trigger policy

**As of 2026-09-21 there is no CI gate.** Code is verified before it is
pushed, in the agent or local loop, and a push to `main` is the release.

| Workflow | Runs when | What it does |
| --- | --- | --- |
| `deploy-cloudflare.yml` | every push to `main`, dispatch | bundle the web app (`build:ship`, no typecheck), deploy the Worker, confirm `https://lupi.live/health` reports the commit; about 90 seconds; a newer push cancels an older run |
| `deploy-render-backend.yml` | path-filtered pushes to `main`, dispatch | Cloud Build and Cloud Run rollout of the render backend |
| `deploy-viewer.yml` | dispatch only | manual Cloud Run fallback for the viewer |

There is no lint, typecheck, unit, browser, audit, or contract workflow.
`pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:ui`, `pnpm audit` and the
`verify:*` scripts remain available to run locally or from an agent before
pushing. Do not add a workflow that runs between a push and production.
